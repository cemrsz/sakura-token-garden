' Sakura Token Bahcesi: sunucuyu konsol penceresi olmadan baslatir ve widget penceresini acar.
' Kapatmak icin: Ayarlar > Sunucuyu kapat.
' Windows acilisinda calismasi icin bu dosyanin kisayolunu shell:startup klasorune koyun.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node server.js --widget", 0, False
