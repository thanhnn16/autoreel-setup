# Script PowerShell để tạo và xem file ASS với background bo góc dựa trên file ASS đầu vào

param (
    [Parameter(Mandatory=$false)]
    [string]$InputAssFile = "input.ass", # File ASS đầu vào mặc định
    
    [Parameter(Mandatory=$false)]
    [string]$OutputAssFile = "D:\output_rounded_corners.ass", # File ASS đầu ra
    
    [Parameter(Mandatory=$false)]
    [int]$BorderRadius = 24, # Bán kính bo góc mặc định
    
    [Parameter(Mandatory=$false)]
    [double]$PaddingHFactor = 0.1, # Giảm padding ngang với chữ (từ 0.2 xuống 0.15)
    
    [Parameter(Mandatory=$false)]
    [double]$PaddingVFactor = 0.25,  # Giảm padding dọc (từ 0.15 xuống 0.1)
    
    [Parameter(Mandatory=$false)]
    [double]$CharWidthFactor = 0.55, # Giữ nguyên hệ số chiều rộng ký tự
    
    [Parameter(Mandatory=$false)]
    [double]$LineHeightFactor = 2, # Tăng chiều cao dòng (từ 1.4 lên 1.5)
    
    [Parameter(Mandatory=$false)]
    [double]$MinWidthFactor = 2, # Hệ số chiều rộng tối thiểu (tỷ lệ với font size) - giảm xuống
    
    [Parameter(Mandatory=$false)]
    [double]$MaxWidthFactor = 0.98,  # Giảm chiều rộng tối đa (từ 0.75 xuống 0.7)
    
    [Parameter(Mandatory=$false)]
    [double]$MinHeightFactor = 0.85, # Giảm chiều cao tối thiểu (từ 0.9 xuống 0.8)
    
    [Parameter(Mandatory=$false)]
    [double]$CornerRadiusFactor = 0.25, # Hệ số bán kính bo góc (tỷ lệ với font size)
    
    [Parameter(Mandatory=$false)]
    [double]$BackgroundOpacity = 0.6, # Độ mờ của background (0-1)
    
    [Parameter(Mandatory=$false)]
    [string]$BackgroundColor = "303030" # Màu nền (RGB)
)

# Kiểm tra file đầu vào tồn tại
if (-not (Test-Path $InputAssFile)) {
    Write-Host "Lỗi: Không tìm thấy file ASS đầu vào '$InputAssFile'" -ForegroundColor Red
    exit 1
}

# Đọc nội dung file ASS đầu vào
$assContent = Get-Content -Path $InputAssFile -Encoding UTF8

# Phân tích file ASS để lấy thông tin cần thiết
$scriptInfo = @{}
$styles = @{}
$events = @()
$currentSection = $null

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
    
    # Xử lý dựa trên section
    if ($currentSection -eq "ScriptInfo") {
        if ($line -match '^(\w+):\s*(.+)$') {
            $key = $matches[1]
            $value = $matches[2]
            $scriptInfo[$key] = $value
        }
    }
    elseif ($currentSection -eq "Styles" -and $line -match '^Style:\s*(.+)$') {
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

# Lấy thông tin video từ ScriptInfo
$videoWidth = 1080  # Giá trị mặc định
$videoHeight = 1920 # Giá trị mặc định

if ($scriptInfo.ContainsKey("PlayResX")) {
    $videoWidth = [int]$scriptInfo["PlayResX"]
}
if ($scriptInfo.ContainsKey("PlayResY")) {
    $videoHeight = [int]$scriptInfo["PlayResY"]
}

Write-Host "Kích thước video: $videoWidth x $videoHeight" -ForegroundColor Cyan

# Lấy thông tin style mặc định
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

$fontSize = $defaultStyle.Fontsize
$marginV = $defaultStyle.MarginV
$alignment = $defaultStyle.Alignment
$scaleX = $defaultStyle.ScaleX / 100.0  # Chuyển đổi từ phần trăm sang hệ số
$scaleY = $defaultStyle.ScaleY / 100.0  # Chuyển đổi từ phần trăm sang hệ số
$spacing = $defaultStyle.Spacing

Write-Host "Font size: $fontSize, MarginV: $marginV, Alignment: $alignment, ScaleX: $scaleX, ScaleY: $scaleY, Spacing: $spacing" -ForegroundColor Cyan

# Tạo file ASS mới với background bo góc
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

# Thêm các style từ file gốc
foreach ($style in $styles.Values) {
    $styleStr = "Style: $($style.Name),$($style.Fontname),$($style.Fontsize),$($style.PrimaryColour),$($style.SecondaryColour),$($style.OutlineColour),$($style.BackColour),$($style.Bold),$($style.Italic),$($style.Underline),$($style.StrikeOut),$($style.ScaleX),$($style.ScaleY),$($style.Spacing),$($style.Angle),$($style.BorderStyle),$($style.Outline),$($style.Shadow),$($style.Alignment),$($style.MarginL),$($style.MarginR),$($style.MarginV),$($style.Encoding)"
    $newAssContent += "`n$styleStr"
}

# Tính toán giá trị alpha cho background (0-255, trong đó 0 là hoàn toàn mờ)
$alpha = [int](255 * (1 - $BackgroundOpacity))
$alphaHex = [Convert]::ToString($alpha, 16).PadLeft(2, '0').ToUpper()

# Thêm style Background nếu chưa có
if (-not $styles.ContainsKey("Background")) {
    $newAssContent += "`nStyle: Background,Arial,$fontSize,&H${alphaHex}${BackgroundColor},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,0,0,0,$alignment,$($defaultStyle.MarginL),$($defaultStyle.MarginR),$marginV,1"
}

# Thêm phần Events
$newAssContent += @"

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"@

# Hàm tính toán chiều rộng text dựa trên font và các thuộc tính
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

# Hàm tính toán chiều cao text dựa trên font và số dòng
function Calculate-TextHeight {
    param (
        [int]$numLines,
        [int]$fontSize,
        [double]$scaleY,
        [double]$lineHeightFactor
    )
    
    # Tính toán chiều cao dựa trên số dòng, font size và scale
    return $numLines * ($fontSize * $scaleY * $lineHeightFactor)
}

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
    
    $fontSize = $style.Fontsize
    $alignment = $style.Alignment
    $scaleX = $style.ScaleX / 100.0
    $scaleY = $style.ScaleY / 100.0
    $spacing = $style.Spacing
    
    # Lấy text từ dialogue và loại bỏ các tag ASS
    $text = $event.Text
    $cleanText = $text -replace '\{\\[^}]*\}', '' # Loại bỏ các tag ASS
    
    # Phân tích text thành các dòng
    $lines = $cleanText -split '\\N|\\n'
    $numLines = $lines.Count
    
    # Tìm dòng dài nhất để tính chiều rộng
    $maxLineLength = 0
    $maxLine = ""
    foreach ($line in $lines) {
        if ($line.Length -gt $maxLineLength) {
            $maxLineLength = $line.Length
            $maxLine = $line
        }
    }
    
    Write-Host "Text: $cleanText" -ForegroundColor Yellow
    Write-Host "Số dòng: $numLines, Dòng dài nhất: $maxLine ($maxLineLength ký tự)" -ForegroundColor Yellow
    
    # Tính toán kích thước background
    $padding_h = [int]($fontSize * $PaddingHFactor)
    $padding_v = [int]($fontSize * $PaddingVFactor)
    
    # Tính chiều rộng dựa trên dòng dài nhất
    $textWidth = Calculate-TextWidth -text $maxLine -fontSize $fontSize -scaleX $scaleX -spacing $spacing -charWidthFactor $CharWidthFactor
    
    # Tính chiều rộng nền (có giới hạn min/max)
    $calculated_width = [int]($textWidth) + ($padding_h * 2)
    $min_width = $fontSize * $MinWidthFactor  # Đảm bảo nền không quá nhỏ
    $max_width = [int]($videoWidth * $MaxWidthFactor)  # Đảm bảo nền không vượt quá % màn hình
    $bg_width = [Math]::Min([Math]::Max($calculated_width, $min_width), $max_width)
    
    # Tính chiều cao text
    $textHeight = Calculate-TextHeight -numLines $numLines -fontSize $fontSize -scaleY $scaleY -lineHeightFactor $LineHeightFactor
    
    # Tính chiều cao nền
    $bg_height = [int]($textHeight) + ($padding_v * 2)
    $min_height = [int]($fontSize * $MinHeightFactor)
    $bg_height = [Math]::Max($bg_height, $min_height)
    
    # Tính bo góc tương ứng với kích thước nền
    $corner_radius = [Math]::Min([int]($fontSize * $CornerRadiusFactor), [int]($bg_height / 4))
    if ($BorderRadius -gt 0) {
        $corner_radius = $BorderRadius
    }
    
    # Tính toán vị trí background
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
        # Nếu chỉ có 1 dòng, điều chỉnh vị trí Y để căn giữa theo chiều dọc
        $y_offset = [int](($bg_height - $textHeight) / 2)
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
    
    Write-Host "Background: Width=$bg_width, Height=$bg_height, X=$bg_x_start, Y=$bg_y_start, Radius=$corner_radius" -ForegroundColor Green
    
    # Tạo drawing command cho bo góc đẹp hơn với đường cong Bezier
    $scale = 1  # Có thể điều chỉnh scale nếu cần
    $scaled_width = $bg_width / $scale
    $scaled_height = $bg_height / $scale
    $scaled_radius = $corner_radius / $scale
    
    # Tạo drawing command với điểm gốc (0,0)
    $drawing = "m $scaled_radius 0 " +
           "l $($scaled_width - $scaled_radius) 0 " +
           "b $($scaled_width - $scaled_radius/2) 0 $scaled_width $($scaled_radius/2) $scaled_width $scaled_radius " +
           "l $scaled_width $($scaled_height - $scaled_radius) " +
           "b $scaled_width $($scaled_height - $scaled_radius/2) $($scaled_width - $scaled_radius/2) $scaled_height $($scaled_width - $scaled_radius) $scaled_height " +
           "l $scaled_radius $scaled_height " +
           "b $($scaled_radius/2) $scaled_height 0 $($scaled_height - $scaled_radius/2) 0 $($scaled_height - $scaled_radius) " +
           "l 0 $scaled_radius " +
           "b 0 $($scaled_radius/2) $($scaled_radius/2) 0 $scaled_radius 0"
    
    # Tạo background với bo góc
    $bgText = "{\\an7\\pos($($bg_x_start),$($bg_y_start))\\p$scale\\bord0\\shad0\\1c&H${BackgroundColor}&\\1a&H${alphaHex}&}$drawing"
    $bgLine = "Dialogue: 0,$($event.Start),$($event.End),Background,,0,0,0,,$bgText"
    
    # Thêm background vào file ASS mới
    $newAssContent += "`n$bgLine"
    
    # Thêm dialogue gốc vào file ASS mới
    $dialogueLine = "Dialogue: 1,$($event.Start),$($event.End),$($event.Style),$($event.Name),$($event.MarginL),$($event.MarginR),$($event.MarginV),$($event.Effect),$($event.Text)"
    $newAssContent += "`n$dialogueLine"
}

# Lưu file ASS mới
$newAssContent | Out-File -Encoding utf8 $OutputAssFile

Write-Host "Đã tạo file ASS với background bo góc: $OutputAssFile" -ForegroundColor Green

# Mở file bằng VLC (nếu VLC được cài đặt)
if (Test-Path "C:\Program Files\VideoLAN\VLC\vlc.exe") {
    Start-Process "C:\Program Files\VideoLAN\VLC\vlc.exe" -ArgumentList $OutputAssFile
} else {
    Write-Host "Đã tạo file $OutputAssFile, hãy mở bằng VLC hoặc Aegisub để xem kết quả" -ForegroundColor Yellow
}
