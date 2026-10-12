const fs=require('node:fs');
const path=require('node:path');
const extension=require('./extensions/easyeda/extension.json');
const electronDist=path.resolve(__dirname,'node_modules/electron/dist');
module.exports={
 appId:'io.lcsc-library-converter.desktop',productName:'LCSC Library Converter',
 directories:{output:'release'},
 ...(fs.existsSync(path.join(electronDist,'electron.exe'))?{electronDist}:{}),
 // FreeCAD and Tcl read these scripts directly from disk, outside Electron.
 asar:false,
 files:['package.json','LICENSE','THIRD_PARTY.md','src/**/*.cjs','ui/**/*','tools/*.py','tools/*.tcl','tools/*.txt',
  'tools/ad_vendor/**/*','!**/__pycache__/**','!**/*.pyc',
  'extensions/easyeda/extension.json',`dist/${extension.name}_v${extension.version}.eext`],
 extraFiles:[{from:'packaging/使用说明.txt',to:'README.txt'}],
 win:{executableName:'LCSC-Library-Converter',target:[{target:'nsis',arch:['x64']},{target:'zip',arch:['x64']}],
  artifactName:'LCSC-Library-Converter-${version}-win-${arch}.${ext}'},
 nsis:{oneClick:false,perMachine:false,installerLanguages:['en_US','zh_CN'],language:'1033',allowToChangeInstallationDirectory:true,
  createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'LCSC Library Converter',
  deleteAppDataOnUninstall:false,runAfterFinish:false,
  artifactName:'LCSC-Library-Converter-Setup-${version}.${ext}'},
 publish:null
};
