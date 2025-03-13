# Script PowerShell để tạo và xem file ASS với background bo góc dựa trên file ASS đầu vào
<#
.SYNOPSIS
    Tạo file ASS với background bo góc từ file ASS đầu vào.

.DESCRIPTION
    Script này đọc file ASS đầu vào, phân tích nó và tạo một file ASS mới với background bo góc cho mỗi dòng phụ đề.
    Người dùng có thể tùy chỉnh các thông số như bán kính bo góc, độ mờ của nền, màu nền và nhiều thông số khác.

.PARAMETER InputAssFile
    Đường dẫn đến file ASS đầu vào.

.PARAMETER OutputAssFile
    Đường dẫn để lưu file ASS đầu ra.

.PARAMETER BorderRadius
    Bán kính bo góc của background phụ đề (pixel).

.PARAMETER PaddingHFactor
    Hệ số padding ngang, tỷ lệ với kích thước font.

.PARAMETER PaddingVFactor
    Hệ số padding dọc, tỷ lệ với kích thước font.

.PARAMETER CharWidthFactor
    Hệ số chiều rộng ký tự, dùng để tính toán chiều rộng text.

.PARAMETER LineHeightFactor
    Hệ số chiều cao dòng, dùng để tính toán khoảng cách giữa các dòng.

.PARAMETER MinWidthFactor
    Hệ số chiều rộng tối thiểu của background, tỷ lệ với kích thước font.

.PARAMETER MaxWidthFactor
    Hệ số chiều rộng tối đa của background, tỷ lệ với chiều rộng video.

.PARAMETER MinHeightFactor
    Hệ số chiều cao tối thiểu của background, tỷ lệ với kích thước font.

.PARAMETER CornerRadiusFactor
    Hệ số bán kính bo góc, tỷ lệ với kích thước font.

.PARAMETER BackgroundOpacity
    Độ mờ của background (0-1, với 0 là hoàn toàn trong suốt, 1 là đục hoàn toàn).

.PARAMETER BackgroundColor
    Màu nền dạng RGB (hex).

.EXAMPLE
    .\test_ass.ps1 -InputAssFile "input.ass" -OutputAssFile "output.ass" -BorderRadius 20 -BackgroundOpacity 0.7
#>

param (
    [Parameter(Mandatory=$false)]
    [string]$InputAssFile = "input.ass", # File ASS đầu vào mặc định
    
    [Parameter(Mandatory=$false)]
    [string]$OutputAssFile = "D:\output_rounded_corners.ass", # File ASS đầu ra
    
    [Parameter(Mandatory=$false)]
    [int]$BorderRadius = 24, # Bán kính bo góc mặc định
    
    [Parameter(Mandatory=$false)]
    [double]$PaddingHFactor = 0.1,  # Hệ số padding ngang
    
    [Parameter(Mandatory=$false)]
    [double]$PaddingVFactor = 0.2,  # Hệ số padding dọc
    
    [Parameter(Mandatory=$false)]
    [double]$CharWidthFactor = 0.5, # Hệ số chiều rộng ký tự
    
    [Parameter(Mandatory=$false)]
    [double]$LineHeightFactor = 1.6, # Hệ số chiều cao dòng
    
    [Parameter(Mandatory=$false)]
    [double]$MinWidthFactor = 1.2,   # Hệ số chiều rộng tối thiểu
    
    [Parameter(Mandatory=$false)]
    [double]$MaxWidthFactor = 0.95,  # Hệ số chiều rộng tối đa
    
    [Parameter(Mandatory=$false)]
    [double]$MinHeightFactor = 0.8,  # Hệ số chiều cao tối thiểu
    
    [Parameter(Mandatory=$false)]
    [double]$CornerRadiusFactor = 0.15, # Hệ số bán kính bo góc
    
    [Parameter(Mandatory=$false)]
    [double]$BackgroundOpacity = 0.6, # Độ mờ của background (0-1)
    
    [Parameter(Mandatory=$false)]
    [string]$BackgroundColor = "303030" # Màu nền (RGB)
)

#region Kiểm tra đầu vào và khởi tạo
# Kiểm tra file đầu vào tồn tại
if (-not (Test-Path $InputAssFile)) {
    Write-Host "Lỗi: Không tìm thấy file ASS đầu vào '$InputAssFile'" -ForegroundColor Red
    exit 1
}

# Đọc nội dung file ASS đầu vào
$assContent = Get-Content -Path $InputAssFile -Encoding UTF8

# Khởi tạo các đối tượng để lưu trữ dữ liệu từ file ASS
$scriptInfo = @{}  # Lưu thông tin chung của script
$styles = @{}      # Lưu các style được định nghĩa
$events = @()      # Lưu các sự kiện (dialogue)
$currentSection = $null  # Theo dõi section hiện tại đang phân tích
#endregion

#region Hàm tiện ích

<#
.SYNOPSIS
    Tính toán chiều rộng của văn bản dựa trên các thuộc tính font.
.DESCRIPTION
    Hàm này tính toán chiều rộng của văn bản dựa trên kích thước font, tỷ lệ co giãn,
    khoảng cách giữa các ký tự và hệ số chiều rộng ký tự.
.PARAMETER text
    Văn bản cần tính toán chiều rộng.
.PARAMETER fontSize
    Kích thước font.
.PARAMETER scaleX
    Hệ số co giãn theo chiều ngang.
.PARAMETER spacing
    Khoảng cách giữa các ký tự.
.PARAMETER charWidthFactor
    Hệ số chiều rộng ký tự.
.OUTPUTS
    Chiều rộng ước tính của văn bản (pixel).
#>
function Calculate-TextWidth {
    param (
        [string]$text,
        [int]$fontSize,
        [double]$scaleX,
        [double]$spacing,
        [double]$charWidthFactor
    )
    
    # Tính toán chiều rộng dựa trên số ký tự, font size, scale và spacing
    $baseWidth = $text.Length * ($fontSize * $charWidthFactor * $scaleX)
    $spacingWidth = ($text.Length - 1) * $spacing  # Spacing giữa các ký tự
    
    return $baseWidth + $spacingWidth
}

<#
.SYNOPSIS
    Tính toán chiều cao của văn bản dựa trên số dòng và thuộc tính font.
.DESCRIPTION
    Hàm này tính toán chiều cao của văn bản dựa trên số dòng, kích thước font,
    tỷ lệ co giãn theo chiều dọc và hệ số chiều cao dòng.
.PARAMETER numLines
    Số dòng của văn bản.
.PARAMETER fontSize
    Kích thước font.
.PARAMETER scaleY
    Hệ số co giãn theo chiều dọc.
.PARAMETER lineHeightFactor
    Hệ số khoảng cách giữa các dòng.
.OUTPUTS
    Chiều cao ước tính của văn bản (pixel).
#>
function Calculate-TextHeight {
    param (
        [int]$numLines,
        [int]$fontSize,
        [double]$scaleY,
        [double]$lineHeightFactor
    )
    
    # Tính chiều cao mỗi dòng là fontsize * scaleY
    # lineHeightFactor dùng để điều chỉnh khoảng cách giữa các dòng
    $baseHeight = ($fontSize * $scaleY * $numLines) + (($numLines - 1) * $fontSize * $scaleY * ($lineHeightFactor - 1))
    
    # Giảm 10% chiều cao nếu có 2 dòng để tối ưu hiển thị
    if ($numLines -eq 2) {
        $baseHeight = $baseHeight * 0.9
    }
    
    return $baseHeight
}

<#
.SYNOPSIS
    Ước tính số dòng thực tế của văn bản khi hiển thị dựa trên chiều rộng tối đa cho phép.
.DESCRIPTION
    Hàm này ước tính số dòng thực tế của văn bản khi hiển thị trên màn hình,
    dựa trên chiều rộng tối đa cho phép và các thuộc tính font.
.PARAMETER text
    Văn bản cần tính toán số dòng.
.PARAMETER fontSize
    Kích thước font.
.PARAMETER scaleX
    Hệ số co giãn theo chiều ngang.
.PARAMETER charWidthFactor
    Hệ số chiều rộng ký tự.
.PARAMETER maxWidth
    Chiều rộng tối đa cho phép của một dòng (pixel).
.OUTPUTS
    Số dòng ước tính của văn bản.
#>
function Get-ActualLines {
    param (
        [string]$text,
        [int]$fontSize,
        [double]$scaleX,
        [double]$charWidthFactor,
        [int]$maxWidth
    )
    
    # Tách văn bản thành các từ
    $words = $text -split '\s+'
    $currentLineLength = 0
    $lines = 1
    
    # Duyệt qua từng từ và tính toán số dòng cần thiết
    foreach ($word in $words) {
        $wordLength = $word.Length * ($fontSize * $charWidthFactor * $scaleX)
        
        # Nếu thêm từ này vượt quá độ rộng tối đa, xuống dòng mới
        if (($currentLineLength + $wordLength) -gt $maxWidth) {
            $lines++
            $currentLineLength = $wordLength
        } else {
            $currentLineLength += $wordLength + ($fontSize * $charWidthFactor * $scaleX) # Thêm khoảng trắng
        }
    }
    
    return $lines
}

<#
.SYNOPSIS
    Tạo đường viền bo góc dưới dạng lệnh vẽ (drawing command) cho ASS.
.DESCRIPTION
    Hàm này tạo lệnh vẽ để tạo ra hình chữ nhật có bo góc dưới dạng đường cong Bezier.
.PARAMETER width
    Chiều rộng của hình chữ nhật.
.PARAMETER height
    Chiều cao của hình chữ nhật.
.PARAMETER radius
    Bán kính bo góc.
.PARAMETER scale
    Hệ số tỷ lệ để điều chỉnh độ phân giải của đường vẽ.
.OUTPUTS
    Chuỗi lệnh vẽ ASS để tạo hình chữ nhật bo góc.
#>
function Create-RoundedRectangleDrawing {
    param (
        [int]$width,
        [int]$height,
        [int]$radius,
        [int]$scale = 1
    )
    
    # Chia tỷ lệ theo scale
    $scaled_width = $width / $scale
    $scaled_height = $height / $scale
    $scaled_radius = $radius / $scale
    
    # Tạo drawing command với điểm gốc (0,0) và đường cong Bezier cho các góc
    $drawing = "m $scaled_radius 0 " +
               "l $($scaled_width - $scaled_radius) 0 " +
               "b $($scaled_width - $scaled_radius/2) 0 $scaled_width $($scaled_radius/2) $scaled_width $scaled_radius " +
               "l $scaled_width $($scaled_height - $scaled_radius) " +
               "b $scaled_width $($scaled_height - $scaled_radius/2) $($scaled_width - $scaled_radius/2) $scaled_height $($scaled_width - $scaled_radius) $scaled_height " +
               "l $scaled_radius $scaled_height " +
               "b $($scaled_radius/2) $scaled_height 0 $($scaled_height - $scaled_radius/2) 0 $($scaled_height - $scaled_radius) " +
               "l 0 $scaled_radius " +
               "b 0 $($scaled_radius/2) $($scaled_radius/2) 0 $scaled_radius 0"
    
    return $drawing
}
#endregion

#region Phân tích file ASS
# Phân tích từng dòng trong file ASS
foreach ($line in $assContent) {
    # Xác định section hiện tại
    if ($line -match '^\[Script Info\]') {
        $currentSection = "ScriptInfo"
        continue
    }
    elseif ($line -match '^\[V4\+ Styles\]') {
        $currentSection = "Styles"
        continue
    }
    elseif ($line -match '^\[Events\]') {
        $currentSection = "Events"
        continue
    }
    
    # Xử lý dữ liệu dựa trên section hiện tại
    if ($currentSection -eq "ScriptInfo") {
        # Lưu thông tin script (ví dụ: PlayResX, PlayResY, v.v.)
        if ($line -match '^(\w+):\s*(.+)$') {
            $key = $matches[1]
            $value = $matches[2]
            $scriptInfo[$key] = $value
        }
    }
    elseif ($currentSection -eq "Styles" -and $line -match '^Style:\s*(.+)$') {
        # Phân tích và lưu thông tin style
        $styleData = $matches[1].Split(',')
        if ($styleData.Length -ge 22) { # Đảm bảo đủ trường dữ liệu
            $styleName = $styleData[0]
            $styles[$styleName] = @{
                Name = $styleName
                Fontname = $styleData[1]
                Fontsize = [int]$styleData[2]
                PrimaryColour = $styleData[3]
                SecondaryColour = $styleData[4]
                OutlineColour = $styleData[5]
                BackColour = $styleData[6]
                Bold = $styleData[7]
                Italic = $styleData[8]
                Underline = $styleData[9]
                StrikeOut = $styleData[10]
                ScaleX = [double]$styleData[11]
                ScaleY = [double]$styleData[12]
                Spacing = [double]$styleData[13]
                Angle = $styleData[14]
                BorderStyle = $styleData[15]
                Outline = $styleData[16]
                Shadow = $styleData[17]
                Alignment = $styleData[18]
                MarginL = $styleData[19]
                MarginR = $styleData[20]
                MarginV = $styleData[21]
                Encoding = $styleData[22]
            }
        }
    }
    elseif ($currentSection -eq "Events" -and $line -match '^Dialogue:\s*(.+)$') {
        # Phân tích và lưu thông tin dialogue
        $dialogueData = $matches[1].Split(',', 10) # Tách tối đa 10 phần
        if ($dialogueData.Length -ge 10) {
            $events += @{
                Layer = $dialogueData[0]
                Start = $dialogueData[1]
                End = $dialogueData[2]
                Style = $dialogueData[3]
                Name = $dialogueData[4]
                MarginL = $dialogueData[5]
                MarginR = $dialogueData[6]
                MarginV = $dialogueData[7]
                Effect = $dialogueData[8]
                Text = $dialogueData[9]
            }
        }
    }
}
#endregion

#region Xử lý thông tin video và style
# Lấy thông tin kích thước video từ ScriptInfo
$videoWidth = 1080  # Giá trị mặc định
$videoHeight = 1920 # Giá trị mặc định

if ($scriptInfo.ContainsKey("PlayResX")) {
    $videoWidth = [int]$scriptInfo["PlayResX"]
}
if ($scriptInfo.ContainsKey("PlayResY")) {
    $videoHeight = [int]$scriptInfo["PlayResY"]
}

Write-Host "Kích thước video: $videoWidth x $videoHeight" -ForegroundColor Cyan

# Lấy thông tin style mặc định để sử dụng cho các phép tính
$defaultStyle = $null
if ($styles.ContainsKey("Default")) {
    $defaultStyle = $styles["Default"]
} else {
    # Nếu không có style Default, lấy style đầu tiên
    $defaultStyle = $styles.Values | Select-Object -First 1
}

if ($null -eq $defaultStyle) {
    Write-Host "Lỗi: Không tìm thấy style Default trong file ASS" -ForegroundColor Red
    exit 1
}

# Lưu các thuộc tính style quan trọng để sử dụng sau
$fontSize = $defaultStyle.Fontsize
$marginV = $defaultStyle.MarginV
$alignment = $defaultStyle.Alignment
$scaleX = $defaultStyle.ScaleX / 100.0  # Chuyển đổi từ phần trăm sang hệ số
$scaleY = $defaultStyle.ScaleY / 100.0  # Chuyển đổi từ phần trăm sang hệ số
$spacing = $defaultStyle.Spacing

Write-Host "Font size: $fontSize, MarginV: $marginV, Alignment: $alignment, ScaleX: $scaleX, ScaleY: $scaleY, Spacing: $spacing" -ForegroundColor Cyan
#endregion

#region Tạo file ASS mới
# Tạo header cho file ASS mới
$newAssContent = @"
[Script Info]
ScriptType: v4.00+
PlayResX: $videoWidth
PlayResY: $videoHeight
Title: ASS with Rounded Corners
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
"@

# Thêm các style từ file gốc vào file mới
foreach ($style in $styles.Values) {
    $styleStr = "Style: $($style.Name),$($style.Fontname),$($style.Fontsize),$($style.PrimaryColour),$($style.SecondaryColour),$($style.OutlineColour),$($style.BackColour),$($style.Bold),$($style.Italic),$($style.Underline),$($style.StrikeOut),$($style.ScaleX),$($style.ScaleY),$($style.Spacing),$($style.Angle),$($style.BorderStyle),$($style.Outline),$($style.Shadow),$($style.Alignment),$($style.MarginL),$($style.MarginR),$($style.MarginV),$($style.Encoding)"
    $newAssContent += "`n$styleStr"
}

# Tính toán giá trị alpha cho background (0-255, trong đó 0 là hoàn toàn mờ)
# Chuyển đổi độ mờ từ 0-1 thành giá trị alpha trong hệ hex (00-FF)
$alpha = [int](255 * (1 - $BackgroundOpacity))
$alphaHex = [Convert]::ToString($alpha, 16).PadLeft(2, '0').ToUpper()

# Thêm style Background nếu chưa có
if (-not $styles.ContainsKey("Background")) {
    $newAssContent += "`nStyle: Background,Arial,$fontSize,&H${alphaHex}${BackgroundColor},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,0,0,0,$alignment,$($defaultStyle.MarginL),$($defaultStyle.MarginR),$marginV,1"
}

# Thêm phần Events header
$newAssContent += @"

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"@
#endregion

#region Xử lý và tạo background cho mỗi dialogue
# Xử lý từng dialogue và tạo background tương ứng
foreach ($event in $events) {
    # Bỏ qua nếu đã là background
    if ($event.Style -eq "Background") {
        continue
    }
    
    # Lấy style tương ứng với dialogue
    $style = $defaultStyle
    if ($styles.ContainsKey($event.Style)) {
        $style = $styles[$event.Style]
    }
    
    # Lấy các thuộc tính font và style
    $fontSize = $style.Fontsize
    $alignment = $style.Alignment
    $scaleX = $style.ScaleX / 100.0
    $scaleY = $style.ScaleY / 100.0
    $spacing = $style.Spacing
    
    # Lấy text từ dialogue và loại bỏ các tag ASS
    $text = $event.Text
    $cleanText = $text -replace '\{\\[^}]*\}', ''
    
    # Tính toán số dòng thực tế và chiều rộng tối đa
    $maxLineWidth = $videoWidth * $MaxWidthFactor
    $numLines = Get-ActualLines -text $cleanText -fontSize $fontSize -scaleX $scaleX -charWidthFactor $CharWidthFactor -maxWidth $maxLineWidth
    
    #region Tính toán kích thước và vị trí background
    # Tính toán padding dựa trên kích thước font
    $padding_h = [int]($fontSize * $PaddingHFactor)
    $padding_v = [int]($fontSize * $PaddingVFactor)
    
    # Giảm padding dọc thêm 10% nếu có 2 dòng để tối ưu hiển thị
    if ($numLines -eq 2) {
        $padding_v = [int]($padding_v * 0.9)
    }
    
    # Tính chiều rộng văn bản
    $textWidth = Calculate-TextWidth -text $cleanText -fontSize $fontSize -scaleX $scaleX -spacing $spacing -charWidthFactor $CharWidthFactor
    
    # Tính chiều rộng nền với giới hạn min/max
    $calculated_width = [int]($textWidth) + ($padding_h * 2)
    $min_width = $fontSize * $MinWidthFactor  # Đảm bảo nền không quá nhỏ
    $max_width = [int]($videoWidth * $MaxWidthFactor)  # Đảm bảo nền không vượt quá % màn hình
    $bg_width = [Math]::Min([Math]::Max($calculated_width, $min_width), $max_width)
    
    # Tính chiều cao văn bản
    $textHeight = Calculate-TextHeight -numLines $numLines -fontSize $fontSize -scaleY $scaleY -lineHeightFactor $LineHeightFactor
    
    # Tính chiều cao nền với điều chỉnh cho số dòng
    $bg_height = [int]($textHeight) + ($padding_v * 2)
    
    # Giảm thêm 10% chiều cao nếu có 2 dòng để tối ưu hiển thị
    if ($numLines -eq 2) {
        $bg_height = [int]($bg_height * 0.9)
    }
    
    # Đảm bảo chiều cao tối thiểu
    $min_height = [int]($fontSize * $MinHeightFactor)
    $bg_height = [Math]::Max($bg_height, $min_height)
    
    # Tính bán kính bo góc tương ứng với kích thước nền
    $corner_radius = [Math]::Min([int]($fontSize * $CornerRadiusFactor), [int]($bg_height / 4))
    if ($BorderRadius -gt 0) {
        $corner_radius = $BorderRadius
    }
    
    # Tính toán vị trí X của background (căn giữa ngang)
    $bg_x_start = [int](($videoWidth - $bg_width) / 2)
    $bg_x_end = $bg_x_start + $bg_width
    
    # Tính toán vị trí Y dựa trên alignment và marginV
    $bg_y_start = 0
    $bg_y_end = 0
    
    # Xử lý alignment để xác định vị trí Y
    # Alignment: 1-3 (dưới), 4-6 (giữa), 7-9 (trên)
    if ($alignment -ge 1 -and $alignment -le 3) {
        # Căn dưới - thêm offset 20px để nâng lên
        $y_offset_bottom = -20  # Điều chỉnh giá trị này để thay đổi độ cao
        $bg_y_end = $videoHeight - $marginV - $y_offset_bottom
        $bg_y_start = $bg_y_end - $bg_height
    } elseif ($alignment -ge 4 -and $alignment -le 6) {
        # Căn giữa
        $bg_y_start = [int](($videoHeight - $bg_height) / 2)
        $bg_y_end = $bg_y_start + $bg_height
    } else {
        # Căn trên
        $bg_y_start = $marginV
        $bg_y_end = $bg_y_start + $bg_height
    }
    
    # Điều chỉnh vị trí Y để căn giữa text trong background
    # Tính toán offset dựa trên số dòng và alignment
    $y_offset = 0
    if ($numLines -eq 1) {
        $y_offset = [int](($bg_height - $textHeight) / 2) # Điều chỉnh căn giữa dọc
    }
    
    # Áp dụng offset dựa trên alignment
    if ($alignment -ge 1 -and $alignment -le 3) {
        # Căn dưới - không cần điều chỉnh
    } elseif ($alignment -ge 4 -and $alignment -le 6) {
        # Căn giữa - không cần điều chỉnh
    } else {
        # Căn trên - điều chỉnh bg_y_start
        $bg_y_start -= $y_offset
        $bg_y_end = $bg_y_start + $bg_height
    }
    #endregion
    
    Write-Host "Background: Width=$bg_width, Height=$bg_height, X=$bg_x_start, Y=$bg_y_start, Radius=$corner_radius" -ForegroundColor Green
    
    # Tạo đường bo góc bằng hàm helper
    $scale = 1  # Hệ số scale cho drawing
    $drawing = Create-RoundedRectangleDrawing -width $bg_width -height $bg_height -radius $corner_radius -scale $scale
    
    # Tạo background với bo góc
    $bgText = "{\\an7\\pos($($bg_x_start),$($bg_y_start))\\p$scale\\bord0\\shad0\\1c&H${BackgroundColor}&\\1a&H${alphaHex}&}$drawing"
    $bgLine = "Dialogue: 0,$($event.Start),$($event.End),Background,,0,0,0,,$bgText"
    
    # Thêm background vào file ASS mới
    $newAssContent += "`n$bgLine"
    
    # Thêm dialogue gốc vào file ASS mới
    $dialogueLine = "Dialogue: 1,$($event.Start),$($event.End),$($event.Style),$($event.Name),$($event.MarginL),$($event.MarginR),$($event.MarginV),$($event.Effect),$($event.Text)"
    $newAssContent += "`n$dialogueLine"
}
#endregion

#region Lưu và mở file
# Lưu file ASS mới
$newAssContent | Out-File -Encoding utf8 $OutputAssFile

Write-Host "Đã tạo file ASS với background bo góc: $OutputAssFile" -ForegroundColor Green

# Mở file bằng VLC nếu được cài đặt
if (Test-Path "C:\Program Files\VideoLAN\VLC\vlc.exe") {
    Start-Process "C:\Program Files\VideoLAN\VLC\vlc.exe" -ArgumentList $OutputAssFile
} else {
    Write-Host "Đã tạo file $OutputAssFile, hãy mở bằng VLC hoặc Aegisub để xem kết quả" -ForegroundColor Yellow
}
#endregion
