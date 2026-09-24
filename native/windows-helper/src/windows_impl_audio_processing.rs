    struct SelectedWasapiFormat {
        ptr: *const WAVEFORMATEX,
        input: WasapiInputFormat,
        _owned: Option<Box<WAVEFORMATEX>>,
    }

    fn select_exclusive_capture_format(
        audio_client: &IAudioClient,
        mix_format: *const WAVEFORMATEX,
    ) -> Result<SelectedWasapiFormat, String> {
        unsafe {
            if audio_client
                .IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, mix_format, None)
                .is_ok()
            {
                return Ok(SelectedWasapiFormat {
                    ptr: mix_format,
                    input: WasapiInputFormat::from_wave_format(mix_format)?,
                    _owned: None,
                });
            }
        }

        let mix = unsafe { WasapiInputFormat::from_wave_format(mix_format)? };
        let mut candidates = exclusive_capture_format_candidates(mix.sample_rate, mix.channels);
        let mut failures = Vec::new();

        for candidate in candidates.drain(..) {
            let candidate_ptr = candidate.as_ref() as *const WAVEFORMATEX;
            let description = describe_wave_format(candidate.as_ref());
            let support = unsafe {
                audio_client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, candidate_ptr, None)
            };

            if support.is_ok() {
                return Ok(SelectedWasapiFormat {
                    ptr: candidate_ptr,
                    input: unsafe { WasapiInputFormat::from_wave_format(candidate_ptr)? },
                    _owned: Some(candidate),
                });
            }

            failures.push(format!("{description}: {support:?}"));
        }

        Err(format!(
            "No supported exclusive microphone format was found. Tried {}",
            failures.join("; ")
        ))
    }

    fn exclusive_capture_format_candidates(
        mix_sample_rate: usize,
        mix_channels: usize,
    ) -> Vec<Box<WAVEFORMATEX>> {
        let mut sample_rates = vec![mix_sample_rate as u32, 48_000, 44_100, 16_000];
        sample_rates.sort_unstable();
        sample_rates.dedup();
        sample_rates.reverse();

        let mut channels = vec![mix_channels.clamp(1, 2) as u16, 1, 2];
        channels.sort_unstable();
        channels.dedup();

        let mut candidates = Vec::new();

        for sample_rate in sample_rates {
            for channel_count in &channels {
                candidates.push(Box::new(wave_format_pcm(sample_rate, *channel_count, 16)));
                candidates.push(Box::new(wave_format_float(sample_rate, *channel_count)));
                candidates.push(Box::new(wave_format_pcm(sample_rate, *channel_count, 24)));
            }
        }

        candidates
    }

    fn wave_format_pcm(sample_rate: u32, channels: u16, bits_per_sample: u16) -> WAVEFORMATEX {
        let block_align = channels * (bits_per_sample / 8);

        WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM as u16,
            nChannels: channels,
            nSamplesPerSec: sample_rate,
            nAvgBytesPerSec: sample_rate * u32::from(block_align),
            nBlockAlign: block_align,
            wBitsPerSample: bits_per_sample,
            cbSize: 0,
        }
    }

    fn wave_format_float(sample_rate: u32, channels: u16) -> WAVEFORMATEX {
        let bits_per_sample = 32;
        let block_align = channels * (bits_per_sample / 8);

        WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_IEEE_FLOAT as u16,
            nChannels: channels,
            nSamplesPerSec: sample_rate,
            nAvgBytesPerSec: sample_rate * u32::from(block_align),
            nBlockAlign: block_align,
            wBitsPerSample: bits_per_sample,
            cbSize: 0,
        }
    }

    fn describe_wave_format(format: &WAVEFORMATEX) -> String {
        let kind = match format.wFormatTag as u32 {
            WAVE_FORMAT_PCM => "pcm",
            WAVE_FORMAT_IEEE_FLOAT => "float",
            WAVE_FORMAT_EXTENSIBLE => "extensible",
            _ => "unknown",
        };
        let sample_rate = format.nSamplesPerSec;
        let channels = format.nChannels;
        let bits_per_sample = format.wBitsPerSample;

        format!(
            "{}Hz {}ch {}bit {}",
            sample_rate, channels, bits_per_sample, kind
        )
    }

    impl WasapiInputFormat {
        unsafe fn from_wave_format(format: *const WAVEFORMATEX) -> Result<Self, String> {
            if format.is_null() {
                return Err("WASAPI returned a null mix format.".to_string());
            }

            let wave = &*format;
            let mut sample_kind = match wave.wFormatTag as u32 {
                WAVE_FORMAT_PCM => WasapiSampleKind::Pcm,
                WAVE_FORMAT_IEEE_FLOAT => WasapiSampleKind::Float,
                WAVE_FORMAT_EXTENSIBLE => {
                    let extensible = format.cast::<WAVEFORMATEXTENSIBLE>();
                    let sub_format = ptr::addr_of!((*extensible).SubFormat).read_unaligned();

                    if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
                        WasapiSampleKind::Float
                    } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
                        WasapiSampleKind::Pcm
                    } else {
                        return Err("Unsupported WASAPI extensible sample subtype.".to_string());
                    }
                }
                tag => return Err(format!("Unsupported WASAPI sample format tag: {tag}")),
            };

            if wave.wBitsPerSample == 32 && matches!(sample_kind, WasapiSampleKind::Pcm) {
                sample_kind = WasapiSampleKind::Pcm;
            }

            Ok(Self {
                sample_rate: wave.nSamplesPerSec as usize,
                channels: wave.nChannels as usize,
                bits_per_sample: wave.wBitsPerSample,
                block_align: wave.nBlockAlign as usize,
                sample_kind,
            })
        }
    }

    const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
    const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
        GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

    fn convert_wasapi_buffer_to_mono(
        data: *const u8,
        frames: u32,
        flags: u32,
        format: &WasapiInputFormat,
    ) -> Result<Vec<f32>, String> {
        if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
            return Ok(vec![0.0; frames as usize]);
        }

        if data.is_null() {
            return Err("WASAPI returned a null capture buffer.".to_string());
        }

        let bytes_per_sample = usize::from(format.bits_per_sample / 8);

        if bytes_per_sample == 0 || format.channels == 0 || format.block_align == 0 {
            return Err("WASAPI returned an invalid capture format.".to_string());
        }

        let mut output = Vec::with_capacity(frames as usize);

        for frame in 0..frames as usize {
            let frame_offset = frame * format.block_align;
            let mut mono = 0.0f32;

            for channel in 0..format.channels {
                let sample_offset = frame_offset + channel * bytes_per_sample;
                let sample_ptr = unsafe { data.add(sample_offset) };
                mono += read_wasapi_sample(sample_ptr, format.sample_kind, format.bits_per_sample)?;
            }

            output.push(mono / format.channels as f32);
        }

        Ok(output)
    }

    fn read_wasapi_sample(
        sample_ptr: *const u8,
        sample_kind: WasapiSampleKind,
        bits_per_sample: u16,
    ) -> Result<f32, String> {
        match (sample_kind, bits_per_sample) {
            (WasapiSampleKind::Float, 32) => {
                let bytes = unsafe { std::slice::from_raw_parts(sample_ptr, 4) };
                Ok(f32::from_le_bytes(bytes.try_into().unwrap()).clamp(-1.0, 1.0))
            }
            (WasapiSampleKind::Pcm, 8) => {
                let value = unsafe { *sample_ptr } as f32;
                Ok((value - 128.0) / 128.0)
            }
            (WasapiSampleKind::Pcm, 16) => {
                let bytes = unsafe { std::slice::from_raw_parts(sample_ptr, 2) };
                Ok(i16::from_le_bytes(bytes.try_into().unwrap()) as f32 / 32768.0)
            }
            (WasapiSampleKind::Pcm, 24) => {
                let bytes = unsafe { std::slice::from_raw_parts(sample_ptr, 3) };
                let raw = ((bytes[2] as i32) << 24)
                    | ((bytes[1] as i32) << 16)
                    | ((bytes[0] as i32) << 8);
                Ok((raw >> 8) as f32 / 8_388_608.0)
            }
            (WasapiSampleKind::Pcm, 32) => {
                let bytes = unsafe { std::slice::from_raw_parts(sample_ptr, 4) };
                Ok(i32::from_le_bytes(bytes.try_into().unwrap()) as f32 / 2_147_483_648.0)
            }
            _ => Err(format!(
                "Unsupported WASAPI sample width: {bits_per_sample} bits"
            )),
        }
    }

    fn process_audio_chunk(
        chunk: &[f32],
        resampler: &mut FrameResampler,
        frame_emitter: &mut FrameEmitter,
        mut vad: Option<&mut SileroVad>,
        samples: &mut Vec<f32>,
        raw_samples: &mut usize,
        vad_probabilities: &mut Vec<u8>,
        level_meter: &mut LevelMeter,
        realtime_resampler: Option<&mut FrameResampler>,
    ) {
        let mut realtime_resampler = realtime_resampler;
        level_meter.push(chunk);
        if let Some(resampler) = realtime_resampler.as_mut() {
            resampler.push(chunk, &mut |resampled| {
                emit_realtime_pcm16_chunk(resampled);
            });
        }
        resampler.push(chunk, &mut |resampled| {
            *raw_samples += resampled.len();
            frame_emitter.push(resampled, &mut |frame| {
                process_vad_frame(frame, vad.as_deref_mut(), samples, vad_probabilities);
            });
        });
    }

    fn emit_realtime_pcm16_chunk(samples: &[f32]) {
        if samples.is_empty() {
            return;
        }

        let mut pcm16 = Vec::with_capacity(samples.len() * 2);
        for sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            let value = (clamped * i16::MAX as f32).round() as i16;
            pcm16.extend_from_slice(&value.to_le_bytes());
        }

        if let Ok(payload) = serde_json::to_string(&RealtimePcm16ChunkResponse {
            type_: "realtimePcm16Chunk",
            encoding: "pcm16",
            sample_rate_hz: OPENAI_REALTIME_SAMPLE_RATE as u32,
            channel_count: 1,
            audio_base64: BASE64_STANDARD.encode(pcm16),
        }) {
            println!("{payload}");
            let _ = io::stdout().flush();
        }
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RealtimePcm16ChunkResponse {
        #[serde(rename = "type")]
        type_: &'static str,
        encoding: &'static str,
        sample_rate_hz: u32,
        channel_count: u32,
        audio_base64: String,
    }

    struct LevelMeter {
        last_emit: std::time::Instant,
    }

    impl LevelMeter {
        fn new() -> Self {
            Self {
                last_emit: std::time::Instant::now() - Duration::from_millis(100),
            }
        }

        fn push(&mut self, chunk: &[f32]) {
            if chunk.is_empty() || self.last_emit.elapsed() < Duration::from_millis(80) {
                return;
            }

            self.last_emit = std::time::Instant::now();
            let rms = (chunk.iter().map(|sample| sample * sample).sum::<f32>()
                / chunk.len() as f32)
                .sqrt()
                .clamp(0.0, 1.0);
            let peak = chunk
                .iter()
                .map(|sample| sample.abs())
                .fold(0.0_f32, f32::max)
                .clamp(0.0, 1.0);

            if let Ok(payload) = serde_json::to_string(&RecordingLevelResponse {
                type_: "recordingLevel",
                rms,
                peak,
            }) {
                println!("{payload}");
                let _ = io::stdout().flush();
            }
        }
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecordingLevelResponse {
        #[serde(rename = "type")]
        type_: &'static str,
        rms: f32,
        peak: f32,
    }

    /// Keeps every frame and records the Silero speech probability for it (quantized to u8).
    /// Speech segmentation happens later on the full recording, so nothing is cut here.
    fn process_vad_frame(
        frame: &[f32],
        vad: Option<&mut SileroVad>,
        samples: &mut Vec<f32>,
        vad_probabilities: &mut Vec<u8>,
    ) {
        samples.extend_from_slice(frame);

        if let Some(vad) = vad {
            let probability = vad.probability(frame).unwrap_or_else(|error| {
                eprintln!("VAD frame failed, treating it as speech: {error}");
                1.0
            });
            vad_probabilities.push((probability.clamp(0.0, 1.0) * 255.0).round() as u8);
        }
    }

    fn count_speech_frames(vad_probabilities: &[u8]) -> usize {
        vad_probabilities
            .iter()
            .filter(|probability| **probability >= 128)
            .count()
    }

    fn get_preferred_input_config(
        device: &cpal::Device,
    ) -> Result<cpal::SupportedStreamConfig, String> {
        let default_config = device
            .default_input_config()
            .map_err(|error| error.to_string())?;
        let target_rate = default_config.sample_rate();
        let mut best_config: Option<cpal::SupportedStreamConfigRange> = None;

        if let Ok(configs) = device.supported_input_configs() {
            for config in configs {
                if config.min_sample_rate() <= target_rate
                    && config.max_sample_rate() >= target_rate
                {
                    match &best_config {
                        None => best_config = Some(config),
                        Some(current) => {
                            if sample_format_score(config.sample_format())
                                > sample_format_score(current.sample_format())
                            {
                                best_config = Some(config);
                            }
                        }
                    }
                }
            }
        }

        Ok(best_config
            .map(|config| config.with_sample_rate(target_rate))
            .unwrap_or(default_config))
    }

    fn find_input_device_by_name(host: &cpal::Host, name: &str) -> Result<cpal::Device, String> {
        let requested = name.trim();

        if requested.is_empty() {
            return host
                .default_input_device()
                .ok_or_else(|| "No input device found.".to_string());
        }

        let devices = host
            .input_devices()
            .map_err(|error| format!("Could not list input devices: {error}"))?;

        for device in devices {
            let device_name = device
                .description()
                .map(|description| description.name().to_string())
                .map_err(|error| format!("Could not read input device name: {error}"))?;

            if device_name == requested {
                return Ok(device);
            }
        }

        Err(format!("Selected input device was not found: {requested}"))
    }

    fn sample_format_score(format: cpal::SampleFormat) -> u8 {
        match format {
            cpal::SampleFormat::F32 => 4,
            cpal::SampleFormat::I16 => 3,
            cpal::SampleFormat::I32 => 2,
            _ => 1,
        }
    }

    fn build_input_stream<T>(
        device: &cpal::Device,
        config: &cpal::SupportedStreamConfig,
        channels: usize,
        sample_tx: mpsc::Sender<Vec<f32>>,
    ) -> Result<cpal::Stream, String>
    where
        T: PcmSample + SizedSample + Send + 'static,
    {
        device
            .build_input_stream(
                config.clone().into(),
                move |data: &[T], _| {
                    let mut output = Vec::with_capacity(data.len() / channels.max(1));

                    if channels == 1 {
                        output.extend(data.iter().map(PcmSample::to_f32));
                    } else {
                        for frame in data.chunks_exact(channels) {
                            output.push(
                                frame.iter().map(PcmSample::to_f32).sum::<f32>() / channels as f32,
                            );
                        }
                    }

                    let _ = sample_tx.send(output);
                },
                move |error| eprintln!("Audio stream error: {error}"),
                None,
            )
            .map_err(|error| error.to_string())
    }

    trait PcmSample {
        fn to_f32(&self) -> f32;
    }

    impl PcmSample for u8 {
        fn to_f32(&self) -> f32 {
            (*self as f32 - 128.0) / 128.0
        }
    }

    impl PcmSample for u16 {
        fn to_f32(&self) -> f32 {
            (*self as f32 - 32768.0) / 32768.0
        }
    }

    impl PcmSample for u32 {
        fn to_f32(&self) -> f32 {
            (*self as f32 - 2_147_483_648.0) / 2_147_483_648.0
        }
    }

    impl PcmSample for u64 {
        fn to_f32(&self) -> f32 {
            (*self as f64 - 9_223_372_036_854_775_808.0) as f32 / 9_223_372_036_854_775_808.0_f32
        }
    }

    impl PcmSample for i8 {
        fn to_f32(&self) -> f32 {
            *self as f32 / 128.0
        }
    }

    impl PcmSample for i16 {
        fn to_f32(&self) -> f32 {
            *self as f32 / 32768.0
        }
    }

    impl PcmSample for i32 {
        fn to_f32(&self) -> f32 {
            *self as f32 / 2_147_483_648.0
        }
    }

    impl PcmSample for i64 {
        fn to_f32(&self) -> f32 {
            (*self as f64 / 9_223_372_036_854_775_808.0) as f32
        }
    }

    impl PcmSample for f32 {
        fn to_f32(&self) -> f32 {
            *self
        }
    }

    impl PcmSample for f64 {
        fn to_f32(&self) -> f32 {
            *self as f32
        }
    }

    struct FrameResampler {
        resampler: Option<Fft<f32>>,
        chunk_in: usize,
        in_buf: Vec<f32>,
        out_buf: Vec<f32>,
    }

    impl FrameResampler {
        fn new(input_rate: usize, output_rate: usize) -> Self {
            let resampler = (input_rate != output_rate).then(|| {
                Fft::<f32>::new_custom(
                    input_rate,
                    output_rate,
                    RESAMPLER_CHUNK_SIZE,
                    1,
                    1,
                    WindowFunction::BlackmanHarris2,
                    FixedSync::Input,
                )
                .expect("create resampler")
            });
            let chunk_in = resampler
                .as_ref()
                .map_or(RESAMPLER_CHUNK_SIZE, |resampler| resampler.input_frames_next());
            let out_len = resampler
                .as_ref()
                .map_or(0, |resampler| resampler.output_frames_max());

            Self {
                resampler,
                chunk_in,
                in_buf: Vec::with_capacity(chunk_in),
                out_buf: vec![0.0; out_len],
            }
        }

        fn process_in_buf(&mut self, emit: &mut impl FnMut(&[f32])) {
            let Some(resampler) = self.resampler.as_mut() else {
                return;
            };
            let Ok(input) = InterleavedSlice::new(&self.in_buf, 1, self.chunk_in) else {
                return;
            };
            let out_capacity = self.out_buf.len();
            let Ok(mut output) = InterleavedSlice::new_mut(&mut self.out_buf, 1, out_capacity)
            else {
                return;
            };

            if let Ok((_, frames_out)) = resampler.process_into_buffer(&input, &mut output, None) {
                emit(&self.out_buf[..frames_out]);
            }
        }

        fn push(&mut self, mut input: &[f32], emit: &mut impl FnMut(&[f32])) {
            if self.resampler.is_none() {
                emit(input);
                return;
            }

            while !input.is_empty() {
                let available = self.chunk_in - self.in_buf.len();
                let count = available.min(input.len());
                self.in_buf.extend_from_slice(&input[..count]);
                input = &input[count..];

                if self.in_buf.len() == self.chunk_in {
                    self.process_in_buf(emit);
                    self.in_buf.clear();
                }
            }
        }

        fn finish(&mut self, emit: &mut impl FnMut(&[f32])) {
            if self.resampler.is_some() && !self.in_buf.is_empty() {
                self.in_buf.resize(self.chunk_in, 0.0);
                self.process_in_buf(emit);
                self.in_buf.clear();
            }
        }
    }

    struct FrameEmitter {
        frame_samples: usize,
        pending: Vec<f32>,
    }

    impl FrameEmitter {
        fn new(frame_samples: usize) -> Self {
            Self {
                frame_samples,
                pending: Vec::with_capacity(frame_samples),
            }
        }

        fn push(&mut self, mut input: &[f32], emit: &mut impl FnMut(&[f32])) {
            while !input.is_empty() {
                let available = self.frame_samples - self.pending.len();
                let count = available.min(input.len());
                self.pending.extend_from_slice(&input[..count]);
                input = &input[count..];

                if self.pending.len() == self.frame_samples {
                    emit(&self.pending);
                    self.pending.clear();
                }
            }
        }

        fn finish(&mut self, emit: &mut impl FnMut(&[f32])) {
            if !self.pending.is_empty() {
                self.pending.resize(self.frame_samples, 0.0);
                emit(&self.pending);
                self.pending.clear();
            }
        }
    }

    struct SileroVad {
        engine: Vad,
    }

    impl SileroVad {
        fn new(model_path: &str) -> Result<Self, String> {
            Ok(Self {
                engine: Vad::new(model_path, VOXTYPE_SAMPLE_RATE)
                    .map_err(|error| format!("Failed to create Silero VAD: {error}"))?,
            })
        }

        fn probability(&mut self, frame: &[f32]) -> Result<f32, String> {
            if frame.len() != VAD_FRAME_SAMPLES {
                return Err(format!(
                    "Expected {VAD_FRAME_SAMPLES} VAD samples, got {}.",
                    frame.len()
                ));
            }

            self.engine
                .compute(frame)
                .map(|result| result.prob)
                .map_err(|error| format!("Silero VAD error: {error}"))
        }

        /// Clears the Silero LSTM state so a warm session starts each recording fresh.
        fn reset(&mut self) {
            self.engine.reset();
        }
    }
