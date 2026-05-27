    pub fn capture_screenshot(
        output_path: &str,
        active_window_only: bool,
        hwnd: Option<&str>,
    ) -> Result<(), String> {
        let rect = screenshot_rect(active_window_only, hwnd)?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;

        if width <= 0 || height <= 0 {
            return Err("Screenshot target has no visible area.".to_string());
        }

        let screen_dc = unsafe { GetDC(None) };
        if screen_dc.0.is_null() {
            return Err("Could not get the screen device context.".to_string());
        }

        let result = capture_rect_to_png(screen_dc, rect, output_path);
        unsafe {
            ReleaseDC(None, screen_dc);
        }
        result
    }

    pub fn recognize_image_text(input_path: &str) -> Result<WindowsOcrResult, String> {
        let started = std::time::Instant::now();
        let path = std::fs::canonicalize(input_path)
            .map_err(|error| format!("Could not resolve OCR image path: {error}"))?;
        let path_string = path.to_string_lossy().to_string();
        let image = load_ocr_image(&path_string)?;
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|error| format!("Could not create Windows OCR engine: {error}"))?;
        let mut lines = Vec::new();
        let mut text_lines = Vec::new();
        let mut seen_lines = HashSet::new();
        let max_dimension = OcrEngine::MaxImageDimension()
            .map_err(|error| format!("Could not read Windows OCR max image dimension: {error}"))?;

        for tile in ocr_tiles(image.width, image.height, max_dimension) {
            let bitmap = software_bitmap_for_tile(&image, tile)?;
            let tile_lines = recognize_software_bitmap_lines(&engine, &bitmap)?;

            for text in tile_lines {
                let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");

                if normalized.is_empty() || !seen_lines.insert(normalized.to_lowercase()) {
                    continue;
                }

                text_lines.push(normalized.clone());
                lines.push(WindowsOcrLine {
                    text: normalized,
                    confidence: None,
                    box_: None,
                });
            }
        }

        Ok(WindowsOcrResult {
            provider: "windowsMediaOcr".to_string(),
            engine: ocr_engine_label(&engine),
            image_path: path_string,
            text: text_lines.join("\n"),
            lines,
            duration_ms: started.elapsed().as_millis(),
        })
    }

    fn recognize_software_bitmap_lines(
        engine: &OcrEngine,
        bitmap: &SoftwareBitmap,
    ) -> Result<Vec<String>, String> {
        let result = engine
            .RecognizeAsync(bitmap)
            .map_err(|error| format!("Could not start Windows OCR: {error}"))?
            .join()
            .map_err(|error| format!("Windows OCR failed: {error}"))?;
        let ocr_lines = result
            .Lines()
            .map_err(|error| format!("Could not read Windows OCR lines: {error}"))?;
        let mut lines = Vec::new();

        for index in 0..ocr_lines
            .Size()
            .map_err(|error| format!("Could not count Windows OCR lines: {error}"))?
        {
            let line = ocr_lines
                .GetAt(index)
                .map_err(|error| format!("Could not read Windows OCR line: {error}"))?;
            let text = line
                .Text()
                .map_err(|error| format!("Could not read Windows OCR line text: {error}"))?
                .to_string_lossy();

            if text.trim().is_empty() {
                continue;
            }

            lines.push(text);
        }

        Ok(lines)
    }

    fn load_ocr_image(path: &str) -> Result<OcrImage, String> {
        let image = image::open(path)
            .map_err(|error| format!("Could not decode OCR image: {error}"))?
            .to_rgba8();
        let (width, height) = image.dimensions();
        let mut bgra = image.into_raw();

        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        Ok(OcrImage {
            width,
            height,
            bgra,
        })
    }

    fn software_bitmap_for_tile(
        image: &OcrImage,
        tile: (u32, u32, u32, u32),
    ) -> Result<SoftwareBitmap, String> {
        let (x, y, width, height) = tile;
        let mut bgra = vec![0_u8; width as usize * height as usize * 4];
        let source_stride = image.width as usize * 4;
        let tile_stride = width as usize * 4;

        for row in 0..height as usize {
            let source_start = (y as usize + row) * source_stride + x as usize * 4;
            let source_end = source_start + tile_stride;
            let target_start = row * tile_stride;
            bgra[target_start..target_start + tile_stride]
                .copy_from_slice(&image.bgra[source_start..source_end]);
        }

        software_bitmap_from_bgra(width, height, &bgra)
    }

    fn software_bitmap_from_bgra(
        width: u32,
        height: u32,
        bgra: &[u8],
    ) -> Result<SoftwareBitmap, String> {
        let writer = DataWriter::new()
            .map_err(|error| format!("Could not create OCR image buffer writer: {error}"))?;
        writer
            .WriteBytes(bgra)
            .map_err(|error| format!("Could not write OCR image pixels: {error}"))?;
        let buffer = writer
            .DetachBuffer()
            .map_err(|error| format!("Could not detach OCR image buffer: {error}"))?;

        SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
            BitmapAlphaMode::Premultiplied,
        )
        .map_err(|error| format!("Could not create OCR software bitmap: {error}"))
    }

    fn ocr_tiles(width: u32, height: u32, max_dimension: u32) -> Vec<(u32, u32, u32, u32)> {
        let tile_size = max_dimension.max(1);

        if width <= tile_size && height <= tile_size {
            return vec![(0, 0, width, height)];
        }

        let overlap = OCR_TILE_OVERLAP.min(tile_size.saturating_sub(1));
        let step = tile_size.saturating_sub(overlap).max(1);
        let mut tiles = Vec::new();
        let mut y = 0;

        loop {
            let mut x = 0;
            let tile_height = tile_size.min(height - y);

            loop {
                let tile_width = tile_size.min(width - x);
                tiles.push((x, y, tile_width, tile_height));

                if x + tile_width >= width {
                    break;
                }

                x = (x + step).min(width - 1);
            }

            if y + tile_height >= height {
                break;
            }

            y = (y + step).min(height - 1);
        }

        tiles
    }

    fn ocr_engine_label(engine: &OcrEngine) -> String {
        engine
            .RecognizerLanguage()
            .ok()
            .and_then(|language: Language| language.LanguageTag().ok())
            .map(|tag| format!("Windows.Media.Ocr {tag}"))
            .unwrap_or_else(|| "Windows.Media.Ocr".to_string())
    }

    fn screenshot_rect(active_window_only: bool, hwnd: Option<&str>) -> Result<RECT, String> {
        if let Some(hwnd) = hwnd {
            return window_rect(parse_hwnd(hwnd)?, "target window");
        }

        if active_window_only {
            let hwnd = unsafe { GetForegroundWindow() };

            if hwnd.0.is_null() {
                return Err("No foreground window is currently available.".to_string());
            }

            return window_rect(hwnd, "foreground window");
        }

        Ok(RECT {
            left: unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) },
            top: unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) },
            right: unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) }
                + unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) },
            bottom: unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) }
                + unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) },
        })
    }

    fn window_rect(hwnd: HWND, label: &str) -> Result<RECT, String> {
        let mut rect = RECT::default();
        let dwm_result = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut RECT as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
        };

        if dwm_result.is_err() || rect.right <= rect.left || rect.bottom <= rect.top {
            unsafe { GetWindowRect(hwnd, &mut rect) }
                .map_err(|error| format!("Could not get {label} bounds: {error}"))?;
        }

        Ok(rect)
    }

    fn window_bounds(rect: RECT) -> WindowBounds {
        WindowBounds {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        }
    }

    fn window_covers_monitor(hwnd: HWND, rect: RECT) -> bool {
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };

        if monitor.0.is_null() {
            return false;
        }

        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };

        if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
            return false;
        }

        rects_match_with_tolerance(rect, info.rcMonitor, 2)
    }

    fn rects_match_with_tolerance(first: RECT, second: RECT, tolerance: i32) -> bool {
        (first.left - second.left).abs() <= tolerance
            && (first.top - second.top).abs() <= tolerance
            && (first.right - second.right).abs() <= tolerance
            && (first.bottom - second.bottom).abs() <= tolerance
    }

    fn capture_rect_to_png(screen_dc: HDC, rect: RECT, output_path: &str) -> Result<(), String> {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let memory_dc = unsafe { CreateCompatibleDC(Some(screen_dc)) };

        if memory_dc.0.is_null() {
            return Err("Could not create a compatible screenshot device context.".to_string());
        }

        let bitmap = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };
        if bitmap.0.is_null() {
            unsafe {
                let _ = DeleteDC(memory_dc);
            }
            return Err("Could not create a compatible screenshot bitmap.".to_string());
        }

        let result = copy_bitmap_to_png(screen_dc, memory_dc, bitmap, rect, output_path);

        unsafe {
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
        }

        result
    }

    fn copy_bitmap_to_png(
        screen_dc: HDC,
        memory_dc: HDC,
        bitmap: HBITMAP,
        rect: RECT,
        output_path: &str,
    ) -> Result<(), String> {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let old_object = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };

        if old_object.0.is_null() {
            return Err("Could not select the screenshot bitmap.".to_string());
        }

        unsafe {
            BitBlt(
                memory_dc,
                0,
                0,
                width,
                height,
                Some(screen_dc),
                rect.left,
                rect.top,
                SRCCOPY,
            )
        }
        .map_err(|error| {
            format!("Could not copy the screen into the screenshot bitmap: {error}")
        })?;

        let mut bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0_u8; width as usize * height as usize * 4];
        let scan_lines = unsafe {
            GetDIBits(
                memory_dc,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            )
        };

        unsafe {
            SelectObject(memory_dc, old_object);
        }

        if scan_lines == 0 {
            return Err("Could not read screenshot bitmap pixels.".to_string());
        }

        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }

        let image = ImageBuffer::<Rgba<u8>, _>::from_raw(width as u32, height as u32, pixels)
            .ok_or_else(|| "Could not build screenshot image buffer.".to_string())?;
        image
            .save(output_path)
            .map_err(|error| format!("Could not save screenshot PNG: {error}"))
    }

