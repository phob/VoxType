    pub fn list_input_devices() -> Result<Vec<InputDevice>, String> {
        let host = cpal::default_host();
        let default_name = host
            .default_input_device()
            .and_then(|device| device.name().ok());
        let devices = host
            .input_devices()
            .map_err(|error| format!("Could not list input devices: {error}"))?;
        let mut results = Vec::new();

        for device in devices {
            let name = device
                .name()
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
        let sample_rate = config.sample_rate().0;
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
        let mut frame_emitter = FrameEmitter::new(VAD_FRAME_SAMPLES);
        let mut vad = if vad_config.enabled {
            Some(SmoothedVad::new(
                Box::new(SileroVad::new(
                    vad_config
                        .model_path
                        .as_deref()
                        .ok_or_else(|| "VAD model path is missing.".to_string())?,
                    vad_config.threshold,
                )?),
                vad_config.prefill_frames,
                vad_config.hangover_frames,
                vad_config.preserved_pause_frames,
                vad_config.onset_frames,
            ))
        } else {
            None
        };
        let mut samples = Vec::<f32>::new();
        let mut raw_samples = 0usize;
        let mut speech_frames = 0usize;
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
                        &mut speech_frames,
                        &mut level_meter,
                        emit_realtime_pcm16,
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
                &mut speech_frames,
                &mut level_meter,
                emit_realtime_pcm16,
            );
        }

        resampler.finish(&mut |resampled| {
            raw_samples += resampled.len();
            if emit_realtime_pcm16 {
                emit_realtime_pcm16_chunk(resampled);
            }
            frame_emitter.push(resampled, &mut |frame| {
                process_vad_frame(frame, vad.as_mut(), &mut samples, &mut speech_frames);
            });
        });
        frame_emitter.finish(&mut |frame| {
            process_vad_frame(frame, vad.as_mut(), &mut samples, &mut speech_frames);
        });
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
                speech_frames,
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
        let mut speech_frames = 0usize;
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
            let mut frame_emitter = FrameEmitter::new(VAD_FRAME_SAMPLES);
            let mut vad = if vad_config.enabled {
                Some(SmoothedVad::new(
                    Box::new(SileroVad::new(
                        vad_config
                            .model_path
                            .as_deref()
                            .ok_or_else(|| "VAD model path is missing.".to_string())?,
                        vad_config.threshold,
                    )?),
                    vad_config.prefill_frames,
                    vad_config.hangover_frames,
                    vad_config.preserved_pause_frames,
                    vad_config.onset_frames,
                ))
            } else {
                None
            };

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
                    &mut speech_frames,
                    &mut level_meter,
                    emit_realtime_pcm16,
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
                &mut speech_frames,
                &mut level_meter,
                emit_realtime_pcm16,
            )?;
            audio_client.Stop().map_err(|error| error.to_string())?;

            resampler.finish(&mut |resampled| {
                raw_samples += resampled.len();
                if emit_realtime_pcm16 {
                    emit_realtime_pcm16_chunk(resampled);
                }
                frame_emitter.push(resampled, &mut |frame| {
                    process_vad_frame(frame, vad.as_mut(), &mut samples, &mut speech_frames);
                });
            });
            frame_emitter.finish(&mut |frame| {
                process_vad_frame(frame, vad.as_mut(), &mut samples, &mut speech_frames);
            });
        }

        if !format_ptr.is_null() {
            unsafe {
                CoTaskMemFree(Some(format_ptr.cast()));
            }
        }

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
                speech_frames,
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
        mut vad: Option<&mut SmoothedVad>,
        samples: &mut Vec<f32>,
        raw_samples: &mut usize,
        speech_frames: &mut usize,
        level_meter: &mut LevelMeter,
        emit_realtime_pcm16: bool,
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
                    speech_frames,
                    level_meter,
                    emit_realtime_pcm16,
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

