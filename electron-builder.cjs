const path=require('node:path');
const extension=require('./extensions/easyeda/extension.json');
module.exports={
 appId:'io.lcsc-library-converter.desktop',productName:'立创元件库转换助手',
 directories:{output:'release'},electronDist:path.resolve(__dirname,'node_modules/electron/dist'),
 // FreeCAD and Tcl read these scripts directly from disk, outside Electron.
 asar:false,
 files:['package.json','LICENSE','THIRD_PARTY.md','src/**/*.cjs','ui/**/*','tools/*.py','tools/*.tcl','tools/*.txt',
  'tools/ad_vendor/**/*','!**/__pycache__/**','!**/*.pyc',
  'extensions/easyeda/extension.json',`dist/${extension.name}_v${extension.version}.eext`],
 extraFiles:[{from:'packaging/使用说明.txt',to:'使用说明.txt'}],
 win:{executableName:'LCSC-Library-Converter',target:[{target:'nsis',arch:['x64']},{target:'zip',arch:['x64']}],
  artifactName:'LCSC-Library-Converter-${version}-win-${arch}.${ext}'},
 nsis:{oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,
  createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'立创元件库转换助手',
  deleteAppDataOnUninstall:false,runAfterFinish:false,
  artifactName:'LCSC-Library-Converter-Setup-${version}.${ext}'},
 publish:null
};
