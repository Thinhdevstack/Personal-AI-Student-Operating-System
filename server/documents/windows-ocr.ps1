$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$ocrAsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-Ocr($operation, $resultType) {
  $ocrTask = $ocrAsTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $ocrTask.GetAwaiter().GetResult()
}
$ocrLanguage = [Windows.Globalization.Language]::new('en-US')
$ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($ocrLanguage)
if (-not $ocrEngine) { $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $ocrEngine) { throw 'ocrUnavailable' }
$ocrFile = Await-Ocr ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:STUDENT_OCR_IMAGE)) ([Windows.Storage.StorageFile])
$ocrStream = Await-Ocr ($ocrFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$ocrBitmap = $null
try {
  $ocrDecoder = Await-Ocr ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ocrStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $ocrBitmap = Await-Ocr ($ocrDecoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $ocrResult = Await-Ocr ($ocrEngine.RecognizeAsync($ocrBitmap)) ([Windows.Media.Ocr.OcrResult])
  $ocrLines = @($ocrResult.Lines | ForEach-Object {
    $words = @($_.Words)
    if ($words.Count) {
      [pscustomobject]@{ text=$_.Text; x=($words.BoundingRect.X | Measure-Object -Minimum).Minimum; y=($words.BoundingRect.Y | Measure-Object -Minimum).Minimum; height=($words.BoundingRect.Height | Measure-Object -Maximum).Maximum }
    }
  })
  [pscustomobject]@{ language=$ocrEngine.RecognizerLanguage.LanguageTag; lines=$ocrLines } | ConvertTo-Json -Compress -Depth 4
} finally {
  if ($ocrBitmap) { $ocrBitmap.Dispose() }
  $ocrStream.Dispose()
}
