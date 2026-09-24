# Renders TTS sentences for the dictation corpus.
# Input: path to a JSON array of { text, voice, path }. Output: 48 kHz mono PCM16 WAV files.
param([Parameter(Mandatory = $true)][string]$JobsPath)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$jobs = Get-Content -Raw -LiteralPath $JobsPath | ConvertFrom-Json
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  48000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

foreach ($job in $jobs) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $synth.SelectVoice($job.voice)
    $synth.Rate = 0
    $synth.SetOutputToWaveFile($job.path, $format)
    $synth.Speak($job.text)
  } finally {
    $synth.Dispose()
  }
}
