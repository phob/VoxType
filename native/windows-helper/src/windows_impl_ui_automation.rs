    // Text around the caret of the focused control, read through UI Automation. Used as context for
    // transcript cleanup (continue a sentence, spell names as they already appear). Password fields are
    // never read.
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationTextPattern2, IUIAutomationTextRange, IUIAutomationValuePattern,
        TextPatternRangeEndpoint_End, TextPatternRangeEndpoint_Start, TextUnit_Character,
        UIA_TextPattern2Id, UIA_TextPatternId, UIA_ValuePatternId,
    };

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct FocusedText {
        /// Up to `max_before` characters before the caret (or the end of a value-only control).
        before: String,
        /// Up to `max_after` characters after the caret.
        after: String,
        /// The selected text, which dictation will replace.
        selection: String,
        /// How the text was found: "caret", "selection", "value" or "none".
        source: String,
        is_password: bool,
    }

    pub fn focused_text(max_before: i32, max_after: i32) -> Result<FocusedText, String> {
        unsafe {
            // UI Automation clients work from an STA or MTA; the helper is a short-lived process.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let result = read_focused_text(max_before, max_after);
        unsafe {
            CoUninitialize();
        }
        result
    }

    fn read_focused_text(max_before: i32, max_after: i32) -> Result<FocusedText, String> {
        let automation: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL) }
            .map_err(|error| format!("Could not create UI Automation: {error}"))?;
        let element: IUIAutomationElement = unsafe { automation.GetFocusedElement() }
            .map_err(|error| format!("No focused element: {error}"))?;
        let mut empty = FocusedText {
            before: String::new(),
            after: String::new(),
            selection: String::new(),
            source: "none".to_string(),
            is_password: false,
        };

        if unsafe { element.CurrentIsPassword() }.map(|value| value.as_bool()).unwrap_or(false) {
            empty.is_password = true;
            return Ok(empty);
        }

        if let Some(text) = caret_text(&element, max_before, max_after) {
            return Ok(text);
        }

        // Plain edits without a text pattern: the whole value, and dictation usually appends at the end.
        if let Ok(value) = unsafe { element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) } {
            if let Ok(current) = unsafe { value.CurrentValue() } {
                let text = current.to_string();
                let chars: Vec<char> = text.chars().collect();
                let start = chars.len().saturating_sub(max_before.max(0) as usize);
                empty.before = chars[start..].iter().collect();
                empty.source = "value".to_string();
            }
        }

        Ok(empty)
    }

    fn caret_text(element: &IUIAutomationElement, max_before: i32, max_after: i32) -> Option<FocusedText> {
        let (caret, source) = caret_range(element)?;
        let selection = range_text(&caret, 4_000);

        let before = unsafe { caret.Clone() }.ok()?;
        unsafe {
            before
                .MoveEndpointByRange(TextPatternRangeEndpoint_End, &caret, TextPatternRangeEndpoint_Start)
                .ok()?;
            before
                .MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -max_before)
                .ok()?;
        }

        let after = unsafe { caret.Clone() }.ok()?;
        unsafe {
            after
                .MoveEndpointByRange(TextPatternRangeEndpoint_Start, &caret, TextPatternRangeEndpoint_End)
                .ok()?;
            after
                .MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, max_after)
                .ok()?;
        }

        Some(FocusedText {
            before: range_text(&before, max_before),
            after: range_text(&after, max_after),
            selection,
            source: source.to_string(),
            is_password: false,
        })
    }

    /// The caret as a (possibly empty) range: TextPattern2's caret, else the first selection range.
    fn caret_range(element: &IUIAutomationElement) -> Option<(IUIAutomationTextRange, &'static str)> {
        if let Ok(pattern) = unsafe { element.GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id) } {
            let mut active = BOOL::default();
            if let Ok(range) = unsafe { pattern.GetCaretRange(&mut active) } {
                return Some((range, "caret"));
            }
        }

        let pattern = unsafe { element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) }.ok()?;
        let ranges = unsafe { pattern.GetSelection() }.ok()?;
        if unsafe { ranges.Length() }.ok()? < 1 {
            return None;
        }
        let range = unsafe { ranges.GetElement(0) }.ok()?;
        Some((range, "selection"))
    }

    fn range_text(range: &IUIAutomationTextRange, max_length: i32) -> String {
        unsafe { range.GetText(max_length) }
            .map(|text| text.to_string())
            .unwrap_or_default()
    }
