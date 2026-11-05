# Instala la tarea programada del robot local de ENSO Perú (cada hora, sin ventana).
# Corre con tu usuario, sin permisos de administrador.
#
#   Ver el registro:  notepad $env:LOCALAPPDATA\ensoperu-robot\robot.log
#   Correr ahora:     Start-ScheduledTask -TaskName "ENSO Peru robot"
#   Desinstalar:      Unregister-ScheduledTask -TaskName "ENSO Peru robot" -Confirm:$false

$pythonw = "$env:LOCALAPPDATA\miniconda3\envs\ensoperu\pythonw.exe"
$base = "$env:LOCALAPPDATA\ensoperu-robot"
New-Item -ItemType Directory -Force $base | Out-Null
# La tarea corre esta copia, fuera de la carpeta de trabajo y del clon que se reinicia
Copy-Item "$PSScriptRoot\robot_local.py" "$base\robot_local.py" -Force

$accion = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$base\robot_local.py`"" -WorkingDirectory $base
$inicio = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew -Hidden
Register-ScheduledTask -TaskName "ENSO Peru robot" -Action $accion -Trigger $inicio -Settings $ajustes `
    -Description "Lee SENAMHI y ENFEN desde el Peru y sube los datos a ENSO Peru." -Force | Out-Null
Get-ScheduledTask -TaskName "ENSO Peru robot" | Select-Object TaskName, State
