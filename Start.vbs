Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
exe = root & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Electron not installed. Run npm ci in the project directory.", 16, "EDA Component Hub"
Else
  sh.CurrentDirectory = root
  sh.Run Chr(34) & exe & Chr(34) & " " & Chr(34) & root & Chr(34), 1, False
End If
