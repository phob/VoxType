    pub fn list_input_devices() -> Result<Vec<InputDevice>, String> {
        let host = cpal::default_host();
        let default_name = host
            .default_input_device()
            .and_then(|device| device.description().ok())
            .map(|description| description.name().to_string());
        let devices = host
            .input_devices()
            .map_err(|error| format!("Could not list input devices: {error}"))?;
        let mut results = Vec::new();

        for device in devices {
            let name = device
                .description()
                .map(|description| description.name().to_string())
                .map_err(|error| format!("Could not read input device name: {error}"))?;

            results.push(InputDevice {
                id: name.clone(),
                is_default: default_name.as_deref() == Some(name.as_str()),
                name,
            });
        }

        Ok(results)
    }

    pub fn record_wav_until_stdin_stop(
        output_path: &str,
        recording_config: super::NativeRecordingConfig,
    ) -> Result<(), String> {
        if recording_config.capture_mode != super::CaptureMode::Shared {
            match record_wav_wasapi_exclusive(
                output_path,
                recording_config.vad.clone(),
                recording_config.input_device.as_deref(),
                recording_config.emit_realtime_pcm16,
            ) {
                Ok(()) => return Ok(()),
                Err(error)
                    if recording_config.capture_mode == super::CaptureMode::ExclusiveRequired =>
                {
                    return Err(format!("Exclusive microphone capture failed: {error}"));
                }
                Err(error) => {
                    eprintln!("Exclusive microphone capture failed, falling back to shared capture: {error}");
                }
            }
        }

        record_wav_shared_until_stdin_stop(
            output_path,
            recording_config.vad,
            recording_config.input_device.as_deref(),
            recording_config.emit_realtime_pcm16,
        )
    }

    pub fn record_wav_session(recording_config: super::NativeRecordingConfig) -> Result<(), String> {
        if recording_config.capture_mode != super::CaptureMode::Shared {
            return Err(
                "record-wav-session only supports shared CPAL capture; use record-wav for WASAPI exclusive capture."
                    .to_string(),
            );
        }

        record_wav_shared_session(
            recording_config.vad,
            recording_config.input_device.as_deref(),
            recording_config.emit_realtime_pcm16,
        )
    }

    /// Runs a WAV file through the same resample -> frame -> VAD path as live capture.
    pub fn process_wav_file(
        input_path: &str,
        output_path: &str,
        vad_config: super::NativeVadConfig,
    ) -> Result<(), String> {
        let (input, input_sample_rate) = read_wav_as_mono(input_path)?;
        let mut resampler = FrameResampler::new(input_sample_rate, VOXTYPE_SAMPLE_RATE);
        let mut frame_emitter = FrameEmitter::new(VAD_FRAME_SAMPLES);
        let mut vad = create_vad(&vad_config)?;
        let mut samples = Vec::<f32>::new();
        let mut raw_samples = 0usize;
        let mut vad_probabilities = Vec::<u8>::new();

        for chunk in input.chunks(RESAMPLER_CHUNK_SIZE) {
            resampler.push(chunk, &mut |resampled| {
                raw_samples += resampled.len();
                frame_emitter.push(resampled, &mut |frame| {
                    process_vad_frame(frame, vad.as_mut(), &mut samples, &mut vad_probabilities);
                });
            });
        }
        resampler.finish(&mut |resampled| {
            raw_samples += resampled.len();
            frame_emitter.push(resampled, &mut |frame| {
                process_vad_frame(frame, vad.as_mut(), &mut samples, &mut vad_probabilities);
            });
        });
        frame_emitter.finish(&mut |frame| {
            process_vad_frame(frame, vad.as_mut(), &mut samples, &mut vad_probabilities);
        });

        let output_path = Path::new(output_path);
        // Drop the zero padding of the last VAD frame; the WAV is exactly the captured audio.
        samples.truncate(raw_samples);
        write_wav(output_path, &samples)?;
        println!(
            "{}",
            serde_json::to_string(&RecordingResponse {
                path: output_path.to_string_lossy().to_string(),
                sample_rate: VOXTYPE_SAMPLE_RATE as u32,
                samples: samples.len(),
                raw_samples,
                vad_enabled: vad_config.enabled,
                capture_mode: "fileInput".to_string(),
                speech_frames: count_speech_frames(&vad_probabilities),
                vad_frame_samples: VAD_FRAME_SAMPLES,
                vad_probabilities: BASE64_STANDARD.encode(&vad_probabilities),
            })
            .map_err(|error| error.to_string())?
        );
        Ok(())
    }

    fn read_wav_as_mono(input_path: &str) -> Result<(Vec<f32>, usize), String> {
        let mut reader = hound::WavReader::open(input_path)
            .map_err(|error| format!("Could not open WAV '{input_path}': {error}"))?;
        let spec = reader.spec();
        let channels = usize::from(spec.channels.max(1));
        let interleaved = match spec.sample_format {
            hound::SampleFormat::Float => reader
                .samples::<f32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?,
            hound::SampleFormat::Int => {
                let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
                reader
                    .samples::<i32>()
                    .map(|sample| sample.map(|value| value as f32 / scale))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| error.to_string())?
            }
        };
        let mono = interleaved
            .chunks_exact(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect();

        Ok((mono, spec.sample_rate as usize))
    }

    fn record_wav_shared_until_stdin_stop(
        output_path: &str,
        vad_config: super::NativeVadConfig,
        input_device: Option<&str>,
        emit_realtime_pcm16: bool,
    ) -> Result<(), String> {
        let output_path = Path::new(output_path);
        let host = cpal::default_host();
        let device = match input_device {
            Some(device_name) => find_input_device_by_name(&host, device_name)?,
            None => host
                .default_input_device()
                .ok_or_else(|| "No input device found.".to_string())?,
        };
        let config = get_preferred_input_config(&device)?;
        let sample_rate = config.sample_rate();
        let channels = config.channels() as usize;
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_reader_flag = Arc::clone(&stop_flag);
        let (sample_tx, sample_rx) = mpsc::channel::<Vec<f32>>();

        thread::spawn(move || {
            let mut line = String::new();
            let mut reader = BufReader::new(io::stdin());
            let _ = reader.read_line(&mut line);
            stop_reader_flag.store(true, Ordering::SeqCst);
        });

        let stream = match config.sample_format() {
            cpal::SampleFormat::U8 => {
                build_input_stream::<u8>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::U16 => {
                build_input_stream::<u16>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::U32 => {
                build_input_stream::<u32>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::U64 => {
                build_input_stream::<u64>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I8 => {
                build_input_stream::<i8>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I16 => {
                build_input_stream::<i16>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I32 => {
                build_input_stream::<i32>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I64 => {
                build_input_stream::<i64>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::F32 => {
                build_input_stream::<f32>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::F64 => {
                build_input_stream::<f64>(&device, &config, channels, sample_tx)?
            }
            sample_format => return Err(format!("Unsupported sample format: {sample_format:?}")),
        };

        stream.play().map_err(|error| error.to_string())?;

        let mut resampler = FrameResampler::new(sample_rate as usize, VOXTYPE_SAMPLE_RATE);
        let mut realtime_resampler =
            emit_realtime_pcm16.then(|| FrameResampler::new(sample_rate as usize, OPENAI_REALTIME_SAMPLE_RATE));
        let mut frame_emitter = FrameEmitter::new(VAD_FRAME_SAMPLES);
        let mut vad = create_vad(&vad_config)?;
        let mut samples = Vec::<f32>::new();
        let mut raw_samples = 0usize;
        let mut vad_probabilities = Vec::<u8>::new();
        let mut level_meter = LevelMeter::new();

        while !stop_flag.load(Ordering::SeqCst) {
            match sample_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(chunk) => {
                    process_audio_chunk(
                        &chunk,
                        &mut resampler,
                        &mut frame_emitter,
                        vad.as_mut(),
                        &mut samples,
                        &mut raw_samples,
                        &mut vad_probabilities,
                        &mut level_meter,
                        realtime_resampler.as_mut(),
                    );
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        drop(stream);

        while let Ok(chunk) = sample_rx.try_recv() {
            process_audio_chunk(
                &chunk,
                &mut resampler,
                &mut frame_emitter,
                vad.as_mut(),
                &mut samples,
                &mut raw_samples,
                &mut vad_probabilities,
                &mut level_meter,
                realtime_resampler.as_mut(),
            );
        }

        if let Some(resampler) = realtime_resampler.as_mut() {
            resampler.finish(&mut |resampled| {
                emit_realtime_pcm16_chunk(resampled);
            });
        }
        resampler.finish(&mut |resampled| {
            raw_samples += resampled.len();
            frame_emitter.push(resampled, &mut |frame| {
                process_vad_frame(frame, vad.as_mut(), &mut samples, &mut vad_probabilities);
            });
        });
        frame_emitter.finish(&mut |frame| {
            process_vad_frame(frame, vad.as_mut(), &mut samples, &mut vad_probabilities);
        });
        samples.truncate(raw_samples);
        write_wav(output_path, &samples)?;
        println!(
            "{}",
            serde_json::to_string(&RecordingResponse {
                path: output_path.to_string_lossy().to_string(),
                sample_rate: VOXTYPE_SAMPLE_RATE as u32,
                samples: samples.len(),
                raw_samples,
                vad_enabled: vad_config.enabled,
                capture_mode: "sharedCapture".to_string(),
                speech_frames: count_speech_frames(&vad_probabilities),
                vad_frame_samples: VAD_FRAME_SAMPLES,
                vad_probabilities: BASE64_STANDARD.encode(&vad_probabilities),
            })
            .map_err(|error| error.to_string())?
        );
        Ok(())
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecordingResponse {
        path: String,
        sample_rate: u32,
        samples: usize,
        raw_samples: usize,
        vad_enabled: bool,
        capture_mode: String,
        speech_frames: usize,
        vad_frame_samples: usize,
        vad_probabilities: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecordingReadyResponse {
        #[serde(rename = "type")]
        type_: &'static str,
        sample_rate: u32,
        capture_mode: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecordingErrorResponse {
        #[serde(rename = "type")]
        type_: &'static str,
        error: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", tag = "type")]
    enum RecordingSessionInput {
        Start {
            #[serde(rename = "outputPath")]
            output_path: String,
        },
        Stop,
        Shutdown,
    }

    enum RecordingSessionCommand {
        Start { output_path: String },
        Stop,
        Shutdown,
    }

    enum RecordingSessionAudioChunk {
        Samples(Vec<f32>),
        EndOfStream,
    }

    fn record_wav_shared_session(
        vad_config: super::NativeVadConfig,
        input_device: Option<&str>,
        emit_realtime_pcm16: bool,
    ) -> Result<(), String> {
        let host = cpal::default_host();
        let device = match input_device {
            Some(device_name) => find_input_device_by_name(&host, device_name)?,
            None => host
                .default_input_device()
                .ok_or_else(|| "No input device found.".to_string())?,
        };
        let config = get_preferred_input_config(&device)?;
        let sample_rate = config.sample_rate();
        let channels = config.channels() as usize;
        let paused_flag = Arc::new(AtomicBool::new(true));
        let (sample_tx, sample_rx) = mpsc::channel::<RecordingSessionAudioChunk>();
        let (command_tx, command_rx) = mpsc::channel::<RecordingSessionCommand>();
        let vad_enabled = vad_config.enabled;
        let vad = create_vad(&vad_config)?;

        let stream = match config.sample_format() {
            cpal::SampleFormat::U8 => build_session_input_stream::<u8>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            cpal::SampleFormat::U16 => build_session_input_stream::<u16>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            cpal::SampleFormat::U32 => build_session_input_stream::<u32>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            cpal::SampleFormat::U64 => build_session_input_stream::<u64>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            cpal::SampleFormat::I8 => build_session_input_stream::<i8>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            cpal::SampleFormat::I16 => build_session_input_stream::<i16>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            cpal::SampleFormat::I32 => build_session_input_stream::<i32>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            cpal::SampleFormat::I64 => build_session_input_stream::<i64>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            cpal::SampleFormat::F32 => build_session_input_stream::<f32>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            cpal::SampleFormat::F64 => build_session_input_stream::<f64>(
                &device,
                &config,
                channels,
                sample_tx,
                Arc::clone(&paused_flag),
            )?,
            sample_format => return Err(format!("Unsupported sample format: {sample_format:?}")),
        };

        let consumer_handle = thread::spawn(move || {
            run_recording_session_consumer(
                sample_rate as usize,
                "sharedCapture",
                vad_enabled,
                vad,
                sample_rx,
                command_rx,
                paused_flag,
                emit_realtime_pcm16,
            );
        });

        stream.play().map_err(|error| error.to_string())?;
        emit_recording_ready(RecordingReadyResponse {
            type_: "recordingReady",
            sample_rate: VOXTYPE_SAMPLE_RATE as u32,
            capture_mode: "sharedCapture".to_string(),
        })?;

        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            let line = line.map_err(|error| error.to_string())?;
            if line.trim().is_empty() {
                continue;
            }

            let command = serde_json::from_str::<RecordingSessionInput>(&line)
                .map_err(|error| format!("Invalid recording session command: {error}"))?;
            match command {
                RecordingSessionInput::Start { output_path } => {
                    command_tx
                        .send(RecordingSessionCommand::Start { output_path })
                        .map_err(|error| error.to_string())?;
                }
                RecordingSessionInput::Stop => {
                    command_tx
                        .send(RecordingSessionCommand::Stop)
                        .map_err(|error| error.to_string())?;
                }
                RecordingSessionInput::Shutdown => {
                    let _ = command_tx.send(RecordingSessionCommand::Shutdown);
                    break;
                }
            }
        }

        let _ = command_tx.send(RecordingSessionCommand::Shutdown);
        drop(stream);
        consumer_handle
            .join()
            .map_err(|_| "Recording session thread panicked.".to_string())
    }

    fn build_session_input_stream<T>(
        device: &cpal::Device,
        config: &cpal::SupportedStreamConfig,
        channels: usize,
        sample_tx: mpsc::Sender<RecordingSessionAudioChunk>,
        paused_flag: Arc<AtomicBool>,
    ) -> Result<cpal::Stream, String>
    where
        T: PcmSample + SizedSample + Send + 'static,
    {
        let mut end_of_stream_sent = false;

        device
            .build_input_stream(
                config.clone().into(),
                move |data: &[T], _| {
                    if paused_flag.load(Ordering::SeqCst) {
                        if !end_of_stream_sent {
                            let _ = sample_tx.send(RecordingSessionAudioChunk::EndOfStream);
                            end_of_stream_sent = true;
                        }
                        return;
                    }
                    end_of_stream_sent = false;

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

                    let _ = sample_tx.send(RecordingSessionAudioChunk::Samples(output));
                },
                move |error| eprintln!("Audio stream error: {error}"),
                None,
            )
            .map_err(|error| error.to_string())
    }

    fn run_recording_session_consumer(
        input_sample_rate: usize,
        capture_mode: &'static str,
        vad_enabled: bool,
        mut vad: Option<SileroVad>,
        sample_rx: mpsc::Receiver<RecordingSessionAudioChunk>,
        command_rx: mpsc::Receiver<RecordingSessionCommand>,
        paused_flag: Arc<AtomicBool>,
        emit_realtime_pcm16: bool,
    ) {
        let mut resampler = FrameResampler::new(input_sample_rate, VOXTYPE_SAMPLE_RATE);
        let mut realtime_resampler =
            emit_realtime_pcm16.then(|| FrameResampler::new(input_sample_rate, OPENAI_REALTIME_SAMPLE_RATE));
        let mut frame_emitter = FrameEmitter::new(VAD_FRAME_SAMPLES);
        let mut samples = Vec::<f32>::new();
        let mut raw_samples = 0usize;
        let mut vad_probabilities = Vec::<u8>::new();
        let mut level_meter = LevelMeter::new();
        let mut recording = false;
        let mut output_path: Option<String> = None;

        loop {
            match sample_rx.recv_timeout(Duration::from_millis(20)) {
                Ok(RecordingSessionAudioChunk::Samples(chunk)) => {
                    if recording {
                        process_audio_chunk(
                            &chunk,
                            &mut resampler,
                            &mut frame_emitter,
                            vad.as_mut(),
                            &mut samples,
                            &mut raw_samples,
                            &mut vad_probabilities,
                            &mut level_meter,
                            realtime_resampler.as_mut(),
                        );
                    }
                }
                Ok(RecordingSessionAudioChunk::EndOfStream) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            while let Ok(command) = command_rx.try_recv() {
                match command {
                    RecordingSessionCommand::Start { output_path: path } => {
                        samples.clear();
                        raw_samples = 0;
                        vad_probabilities.clear();
                        output_path = Some(path);
                        resampler = FrameResampler::new(input_sample_rate, VOXTYPE_SAMPLE_RATE);
                        realtime_resampler = emit_realtime_pcm16
                            .then(|| FrameResampler::new(input_sample_rate, OPENAI_REALTIME_SAMPLE_RATE));
                        frame_emitter = FrameEmitter::new(VAD_FRAME_SAMPLES);
                        if let Some(vad) = vad.as_mut() {
                            vad.reset();
                        }
                        level_meter = LevelMeter::new();
                        recording = true;
                        paused_flag.store(false, Ordering::SeqCst);
                    }
                    RecordingSessionCommand::Stop => {
                        recording = false;
                        paused_flag.store(true, Ordering::SeqCst);
                        drain_session_stop(
                            &sample_rx,
                            &mut resampler,
                            &mut frame_emitter,
                            vad.as_mut(),
                            &mut samples,
                            &mut raw_samples,
                            &mut vad_probabilities,
                            &mut level_meter,
                            realtime_resampler.as_mut(),
                        );

                        let result = finish_session_recording(
                            output_path.take(),
                            capture_mode,
                            vad_enabled,
                            &mut resampler,
                            &mut frame_emitter,
                            vad.as_mut(),
                            &mut samples,
                            &mut raw_samples,
                            &mut vad_probabilities,
                            realtime_resampler.as_mut(),
                        );

                        if let Err(error) = result {
                            emit_recording_error(error);
                        }
                    }
                    RecordingSessionCommand::Shutdown => {
                        paused_flag.store(true, Ordering::SeqCst);
                        return;
                    }
                }
            }
        }
    }

    fn create_vad(vad_config: &super::NativeVadConfig) -> Result<Option<SileroVad>, String> {
        if !vad_config.enabled {
            return Ok(None);
        }

        let model_path = vad_config
            .model_path
            .as_deref()
            .ok_or_else(|| "VAD model path is missing.".to_string())?;

        SileroVad::new(model_path).map(Some)
    }

    fn drain_session_stop(
        sample_rx: &mpsc::Receiver<RecordingSessionAudioChunk>,
        resampler: &mut FrameResampler,
        frame_emitter: &mut FrameEmitter,
        mut vad: Option<&mut SileroVad>,
        samples: &mut Vec<f32>,
        raw_samples: &mut usize,
        vad_probabilities: &mut Vec<u8>,
        level_meter: &mut LevelMeter,
        mut realtime_resampler: Option<&mut FrameResampler>,
    ) {
        loop {
            match sample_rx.recv_timeout(Duration::from_secs(2)) {
                Ok(RecordingSessionAudioChunk::Samples(chunk)) => {
                    process_audio_chunk(
                        &chunk,
                        resampler,
                        frame_emitter,
                        vad.as_deref_mut(),
                        samples,
                        raw_samples,
                        vad_probabilities,
                        level_meter,
                        realtime_resampler.as_deref_mut(),
                    );
                }
                Ok(RecordingSessionAudioChunk::EndOfStream) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    eprintln!("Timed out waiting for recording end-of-stream sentinel.");
                    break;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    fn finish_session_recording(
        output_path: Option<String>,
        capture_mode: &'static str,
        vad_enabled: bool,
        resampler: &mut FrameResampler,
        frame_emitter: &mut FrameEmitter,
        mut vad: Option<&mut SileroVad>,
        samples: &mut Vec<f32>,
        raw_samples: &mut usize,
        vad_probabilities: &mut Vec<u8>,
        mut realtime_resampler: Option<&mut FrameResampler>,
    ) -> Result<(), String> {
        let output_path = output_path.ok_or_else(|| "Recording session stop arrived before start.".to_string())?;
        let output_path = Path::new(&output_path);

        if let Some(resampler) = realtime_resampler.as_mut() {
            resampler.finish(&mut |resampled| {
                emit_realtime_pcm16_chunk(resampled);
            });
        }
        resampler.finish(&mut |resampled| {
            *raw_samples += resampled.len();
            frame_emitter.push(resampled, &mut |frame| {
                process_vad_frame(frame, vad.as_deref_mut(), samples, vad_probabilities);
            });
        });
        frame_emitter.finish(&mut |frame| {
            process_vad_frame(frame, vad.as_deref_mut(), samples, vad_probabilities);
        });

        samples.truncate(*raw_samples);
        write_wav(output_path, samples)?;
        println!(
            "{}",
            serde_json::to_string(&RecordingResponse {
                path: output_path.to_string_lossy().to_string(),
                sample_rate: VOXTYPE_SAMPLE_RATE as u32,
                samples: samples.len(),
                raw_samples: *raw_samples,
                vad_enabled,
                capture_mode: capture_mode.to_string(),
                speech_frames: count_speech_frames(vad_probabilities),
                vad_frame_samples: VAD_FRAME_SAMPLES,
                vad_probabilities: BASE64_STANDARD.encode(&*vad_probabilities),
            })
            .map_err(|error| error.to_string())?
        );
        let _ = io::stdout().flush();
        Ok(())
    }

    fn emit_recording_ready(response: RecordingReadyResponse) -> Result<(), String> {
        println!("{}", serde_json::to_string(&response).map_err(|error| error.to_string())?);
        io::stdout().flush().map_err(|error| error.to_string())
    }

    fn emit_recording_error(error: String) {
        if let Ok(payload) = serde_json::to_string(&RecordingErrorResponse {
            type_: "recordingError",
            error,
        }) {
            println!("{payload}");
            let _ = io::stdout().flush();
        }
    }

    fn record_wav_wasapi_exclusive(
        output_path: &str,
        vad_config: super::NativeVadConfig,
        input_device: Option<&str>,
        emit_realtime_pcm16: bool,
    ) -> Result<(), String> {
        let output_path = Path::new(output_path);
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_reader_flag = Arc::clone(&stop_flag);

        thread::spawn(move || {
            let mut line = String::new();
            let mut reader = BufReader::new(io::stdin());
            let _ = reader.read_line(&mut line);
            stop_reader_flag.store(true, Ordering::SeqCst);
        });

        let format_ptr: *mut WAVEFORMATEX;
        let mut samples = Vec::<f32>::new();
        let mut raw_samples = 0usize;
        let mut vad_probabilities = Vec::<u8>::new();
        let mut level_meter = LevelMeter::new();

        unsafe {
            let _com = ComGuard::new()?;
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|error| error.to_string())?;
            let device = find_wasapi_input_device(&enumerator, input_device)?;
            let audio_client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| error.to_string())?;

            format_ptr = audio_client
                .GetMixFormat()
                .map_err(|error| error.to_string())?;
            let selected_format = select_exclusive_capture_format(&audio_client, format_ptr)?;
            let format = selected_format.input;

            let mut default_period = 0i64;
            audio_client
                .GetDevicePeriod(Some(&mut default_period), None)
                .map_err(|error| error.to_string())?;
            let buffer_duration = if default_period > 0 {
                default_period
            } else {
                100_000
            };

            audio_client
                .Initialize(
                    AUDCLNT_SHAREMODE_EXCLUSIVE,
                    0,
                    buffer_duration,
                    buffer_duration,
                    selected_format.ptr,
                    None,
                )
                .map_err(|error| error.to_string())?;

            let capture_client: IAudioCaptureClient = audio_client
                .GetService()
                .map_err(|error| error.to_string())?;
            let mut resampler = FrameResampler::new(format.sample_rate, VOXTYPE_SAMPLE_RATE);
            let mut realtime_resampler =
                emit_realtime_pcm16.then(|| FrameResampler::new(format.sample_rate, OPENAI_REALTIME_SAMPLE_RATE));
            let mut frame_emitter = FrameEmitter::new(VAD_FRAME_SAMPLES);
            let mut vad = create_vad(&vad_config)?;

            audio_client.Start().map_err(|error| error.to_string())?;

            while !stop_flag.load(Ordering::SeqCst) {
                drain_wasapi_capture(
                    &capture_client,
                    &format,
                    &mut resampler,
                    &mut frame_emitter,
                    vad.as_mut(),
                    &mut samples,
                    &mut raw_samples,
                    &mut vad_probabilities,
                    &mut level_meter,
                    realtime_resampler.as_mut(),
                )?;
                thread::sleep(Duration::from_millis(10));
            }

            drain_wasapi_capture(
                &capture_client,
                &format,
                &mut resampler,
                &mut frame_emitter,
                vad.as_mut(),
                &mut samples,
                &mut raw_samples,
                &mut vad_probabilities,
                &mut level_meter,
                realtime_resampler.as_mut(),
            )?;
            audio_client.Stop().map_err(|error| error.to_string())?;

            if let Some(resampler) = realtime_resampler.as_mut() {
                resampler.finish(&mut |resampled| {
                    emit_realtime_pcm16_chunk(resampled);
                });
            }
            resampler.finish(&mut |resampled| {
                raw_samples += resampled.len();
                frame_emitter.push(resampled, &mut |frame| {
                    process_vad_frame(frame, vad.as_mut(), &mut samples, &mut vad_probabilities);
                });
            });
            frame_emitter.finish(&mut |frame| {
                process_vad_frame(frame, vad.as_mut(), &mut samples, &mut vad_probabilities);
            });
        }

        if !format_ptr.is_null() {
            unsafe {
                CoTaskMemFree(Some(format_ptr.cast()));
            }
        }

        samples.truncate(raw_samples);
        write_wav(output_path, &samples)?;
        println!(
            "{}",
            serde_json::to_string(&RecordingResponse {
                path: output_path.to_string_lossy().to_string(),
                sample_rate: VOXTYPE_SAMPLE_RATE as u32,
                samples: samples.len(),
                raw_samples,
                vad_enabled: vad_config.enabled,
                capture_mode: "exclusiveCapture".to_string(),
                speech_frames: count_speech_frames(&vad_probabilities),
                vad_frame_samples: VAD_FRAME_SAMPLES,
                vad_probabilities: BASE64_STANDARD.encode(&vad_probabilities),
            })
            .map_err(|error| error.to_string())?
        );
        Ok(())
    }

    unsafe fn find_wasapi_input_device(
        enumerator: &IMMDeviceEnumerator,
        input_device: Option<&str>,
    ) -> Result<IMMDevice, String> {
        let requested = input_device
            .map(str::trim)
            .filter(|value| !value.is_empty());

        if let Some(requested) = requested {
            let devices = enumerator
                .EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)
                .map_err(|error| error.to_string())?;
            let count = devices.GetCount().map_err(|error| error.to_string())?;

            for index in 0..count {
                let device = devices.Item(index).map_err(|error| error.to_string())?;
                let device_id =
                    pwstr_to_string_and_free(device.GetId().map_err(|error| error.to_string())?);
                let friendly_name = wasapi_device_friendly_name(&device)?;

                if device_id == requested || friendly_name == requested {
                    return Ok(device);
                }
            }

            return Err(format!("Input device '{requested}' was not found."));
        }

        enumerator
            .GetDefaultAudioEndpoint(eCapture, eConsole)
            .map_err(|error| error.to_string())
    }

    unsafe fn wasapi_device_friendly_name(device: &IMMDevice) -> Result<String, String> {
        let property_store = device
            .OpenPropertyStore(STGM_READ)
            .map_err(|error| error.to_string())?;
        let mut property_value = property_store
            .GetValue(&Properties::DEVPKEY_Device_FriendlyName as *const _ as *const _)
            .map_err(|error| error.to_string())?;
        let prop_variant = &property_value.Anonymous.Anonymous;
        let variant_type = prop_variant.vt;

        if variant_type != VT_LPWSTR {
            let _ = StructuredStorage::PropVariantClear(&mut property_value);
            return Err(format!(
                "Input device friendly name had unexpected variant type {:?}.",
                variant_type
            ));
        }

        let ptr_utf16 = prop_variant.Anonymous.pwszVal.0;
        let mut len = 0;

        while *ptr_utf16.offset(len) != 0 {
            len += 1;
        }

        let name_slice = slice::from_raw_parts(ptr_utf16, len as usize);
        let name = OsString::from_wide(name_slice)
            .to_string_lossy()
            .into_owned();
        let _ = StructuredStorage::PropVariantClear(&mut property_value);

        Ok(name)
    }

    fn drain_wasapi_capture(
        capture_client: &IAudioCaptureClient,
        format: &WasapiInputFormat,
        resampler: &mut FrameResampler,
        frame_emitter: &mut FrameEmitter,
        mut vad: Option<&mut SileroVad>,
        samples: &mut Vec<f32>,
        raw_samples: &mut usize,
        vad_probabilities: &mut Vec<u8>,
        level_meter: &mut LevelMeter,
        mut realtime_resampler: Option<&mut FrameResampler>,
    ) -> Result<(), String> {
        unsafe {
            let mut packet_size = capture_client
                .GetNextPacketSize()
                .map_err(|error| error.to_string())?;

            while packet_size > 0 {
                let mut data = std::ptr::null_mut::<u8>();
                let mut frames = 0u32;
                let mut flags = 0u32;

                capture_client
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(|error| error.to_string())?;

                let chunk = convert_wasapi_buffer_to_mono(data, frames, flags, format)?;
                process_audio_chunk(
                    &chunk,
                    resampler,
                    frame_emitter,
                    vad.as_deref_mut(),
                    samples,
                    raw_samples,
                    vad_probabilities,
                    level_meter,
                    realtime_resampler.as_deref_mut(),
                );

                capture_client
                    .ReleaseBuffer(frames)
                    .map_err(|error| error.to_string())?;
                packet_size = capture_client
                    .GetNextPacketSize()
                    .map_err(|error| error.to_string())?;
            }
        }

        Ok(())
    }

    #[derive(Clone, Copy)]
    struct WasapiInputFormat {
        sample_rate: usize,
        channels: usize,
        bits_per_sample: u16,
        block_align: usize,
        sample_kind: WasapiSampleKind,
    }

    #[derive(Clone, Copy)]
    enum WasapiSampleKind {
        Float,
        Pcm,
    }

