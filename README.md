# LCSC Library Converter

## 界面语言

软件自动读取系统首选语言：中文系统（含 zh-CN、zh-TW、zh-HK 等）使用中文；英文及暂未支持的其他系统语言使用英文。软件标题、安装程序、快捷方式及程序主体名称统一为 **LCSC Library Converter**。更名继续使用原有用户数据目录，保留登录状态和导出清单。

本地化覆盖导航、设置、首次使用引导、清单操作、常用校验提示、导出进度及结果弹窗，并包含商城注入的加入清单按钮。商城页面和原始元件名称、参数、描述以及上游诊断原文保持原样。词条位于 `ui/locales/en.js`，语言选择和模板翻译位于 `ui/i18n.js`；增加或修改界面词条时由覆盖测试检查。

`npm run test:i18n` 验证真实中英文界面、最小窗口布局、进度和结果弹窗；测试可通过 `--ui-language=en` / `--ui-language=zh-CN` 覆盖系统语言。

[软件下载](https://github.com/arthur-zyl/lcsc-library-converter/releases/latest) · [自动构建](https://github.com/arthur-zyl/lcsc-library-converter/actions) · [问题反馈](https://github.com/arthur-zyl/lcsc-library-converter/issues)

元件及原始符号、封装、3D 模型来源于立创商城与立创 EDA；本工具提供下载、提取和格式转换功能，为独立开发项目。

Windows Electron 应用：内嵌立创商城选料，连接 EasyEDA Pro 导出原始库，通过 FreeCAD 提取独立 STEP，再转换为目标 EDA 库。目前支持 KiCad、Cadence Capture / Allegro 以及 Altium Designer 原生元件库。

## 自动构建与发布

GitHub Actions 在推送 `main`、提交 Pull Request 或手动运行时，安装锁定的 Node/Python 依赖、运行回归测试、生成 Windows x64 安装程序及免安装 ZIP，并启动实际 EXE 验证。构建产物在 Actions 中保留 14 天。

正式发布先更新 `package.json` / `package-lock.json` 中的版本并提交，再推送对应标签，例如：

```powershell
git tag v0.1.0
git push origin main --tags
```

只有版本标签触发自动 Release。标签必须等于 `v` 加软件版本，否则流水线拒绝发布。Release 包含安装程序、免安装 ZIP、对应项目源码 ZIP、立创 EDA 插件和 SHA256 校验文件。发布使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需添加个人访问令牌；构建任务仅有读取权限，发布任务才有仓库写入权限。

项目采用 AGPL-3.0-or-later；参见 [LICENSE](LICENSE) 和 [资源及第三方依赖说明](THIRD_PARTY.md)。

## 本地 Windows 打包

在 Windows x64 环境完成 `npm ci`，并按下文用 FreeCAD Python 安装 `tools/requirements-ad.txt` 后执行：

```powershell
npm run package:win
```

会自动检查插件类型、构建立创 EDA 插件，并生成 `release/LCSC-Library-Converter-Setup-0.2.0.exe` 安装程序和 `release/LCSC-Library-Converter-0.2.0-win-x64.zip` 免安装包。安装程序支持选择安装目录并创建快捷方式；免安装包需完整解压后运行其中的 `LCSC-Library-Converter.exe`。用户无需安装 Node.js。

`npm run package:dir` 仅生成 `release/win-unpacked`；`npm run package:verify` 检查已构建目录的资源及依赖完整性、排除个人数据，并在独立临时配置目录启动实际 EXE 验证，生成分发文件的 SHA256SUMS.txt。打包器固定为 electron-builder 26.15.3，使用本地已安装的 Electron 分发目录。首次构建可能下载 NSIS 和压缩工具。

包内包含当前版本 `.eext` 插件、转换脚本和 AD 第三方依赖及许可证；不包含个人配置、清单、浏览器登录数据、导出库、故障文件或测试数据。FreeCAD、KiCad、Cadence 本体不随包分发，启动后通过使用引导配置。安装版与免安装版的个人数据均保存在 `%APPDATA%/eda-component-hub/data`，浏览器登录数据保存在同一 userData 目录；卸载保留个人数据。源码运行仍使用工程内 `data`，不会自动合并到分发版。

转换工具由外部 Python/Tcl 进程读取，因此运行资源以实际文件打包；不要单独移动 EXE 或删除 `resources/app/tools`。`release` 为构建产物，不进入 Git。

## 开发环境准备

仓库保留源码、测试、`package-lock.json` 和 AD 依赖版本清单。`node_modules`、`tools/ad_vendor`、构建安装包、个人配置及导出库均不进入 Git；首次运行通过使用引导重新配置本机路径。

在工程根目录执行：

```powershell
npm ci
npm run build:extension
```

使用 AD 导出时，用 FreeCAD 自带的 Python 3.11 恢复第三方依赖（替换为实际安装路径）：

```powershell
& 'C:\Program Files\FreeCAD 1.1\bin\python.exe' -m pip install --target tools/ad_vendor -r tools/requirements-ad.txt
```

`requirements-ad.txt` 固定当前验证的版本，安装后的包及各自许可证位于被忽略的 `tools/ad_vendor`。如果该 Python 未提供 pip，先使用该 Python 的 `-m ensurepip` 安装 pip。

构建完成后执行 `npm test` 验证，执行 `npm start` 启动。插件安装包由 `npm run build:extension` 生成到 `dist`。

## 启动与导出

执行 `npm start`。首次安装依赖执行 `npm ci`。

首次启动会显示使用引导：

- **准备 FreeCAD**：从官网下载并安装 Windows 版本，或选择已有安装的 `bin/python.exe`。软件会查找常见安装目录，实际检测 FreeCAD、Part 和 Import 模块及实体建模。不能选择系统 Python 或 FreeCAD.exe。
- **配置目标库**：先选择一种 EDA、固定导出目录和库名称。KiCad 检查 CLI 版本；Cadence 检查完整 SPB 工具；AD 检查 Python 3.11 与本软件的转换依赖。不会要求先安装所有 EDA。
- **连接立创 EDA**：登录个人账号，复制插件文件夹并导入连接插件，开启外部交互权限。账号登录和插件连接分别显示状态。打开 EDA 操作后，点击顶部「返回使用引导」继续。

首次显示后即记住引导已展示，后续启动不会重复弹出；「稍后配置」可先浏览商城，再通过设置页手动继续。旧版本已有配置的用户升级后也不会自动弹出。完成状态与展示状态分别保存。设置页的「使用引导」可随时重新配置，已有路径会预填。下载按钮使用系统浏览器打开官方网页，不会自动安装工具。


1. 在商城商品详情或搜索结果点击「加入清单」，按钮替换商城原购物车按钮。
2. 在 立创 EDA 工作区登录，安装 `dist/lcsc-cadence-downloader_v0.5.6.eext` 并开启外部交互权限。软件可复制插件所在文件夹。后续启动自动连接。
3. 在导出清单选择目标 EDA（KiCad / Cadence / Altium Designer），然后开始批量导出。应用锁定 EDA 操作、显示进度，允许请求中止；完成当前器件及清理后保存已导出的结果。个人专用工程保留，每批临时 PCB 删除。
4. 下载自动交给 FreeCAD 提取并校验独立 STEP，然后直接转换到目标 EDA 的固定库目录。整个过程保持锁定，转换和清理结束后统一弹窗，可打开最终库目录。中间 ZIP 与提取资源使用每批独立临时目录，任务收尾时删除；不再提供本地资源页或二次手动转换。
5. 设置页左侧按通用、KiCad、Altium Designer、Cadence 分组。通用组配置 FreeCAD Python 并提供连接故障排查；KiCad 组配置程序、库目录和封装库名称；Cadence 组配置 SPB 安装目录、库目录、Capture 库名称，以及已有原理图库更新。切换分组保留未保存修改，保存仅提交当前分组，其他分组未保存内容保留；不会校验未使用 EDA 的安装路径。

重开软件保留待导出清单；成功转换入库的元件从清单移除，失败和未处理项保留供重试，登录会话保留。最终库与 last_export_report.json 诊断报告保留，旧版本已经保存的原始资源不会自动删除。修改保存目录不移动已有文件。

## 转换为 KiCad

需要 KiCad 9 或更新版本。自动查找 C / D / E 盘常见 KiCad 目录、Program Files 和用户 Programs 目录，优先较新的 9 或更新版本。设置和使用引导中可点击「自动检测」重新查找；其他位置手动选择 `bin/kicad-cli.exe`。

在导出清单选择 KiCad 并开始导出。所有转换累计写入设置中的固定目录，同一 C 编号已有资源跳过，仅补齐缺失部分。目录包含：

- `.kicad_sym`：符号库，绑定对应封装，并保留型号、品牌、LCSC 编号及描述。
- `.pretty/*.kicad_mod`：封装库。
- `.3dshapes/*.step`：独立模型，绑定到封装，偏移与旋转为 0、缩放为 1。
- `sym-lib-table`、`fp-lib-table`、中文使用说明与逐器件转换报告。

设置页可填写「KiCad 封装库名称」，默认 LCSC，例如填写 MyParts 后输出 `MyParts.pretty`，符号绑定 `MyParts:原始封装名`。在 KiCad 中添加 `LCSC.kicad_sym`（符号库昵称 LCSC）和 `MyParts.pretty`（封装库昵称必须为 MyParts）。修改名称后重新转换会复制旧封装库，并更新所有已有符号的库名绑定；旧目录保留。

符号条目使用元件型号（例如 ADM3057EBRWZ-RL），封装条目使用原始封装名称（例如 SOIC-20_L13.0-W7.6-P1.27-LS10.3-BL）。同名不同器件会补充品牌或型号以避免覆盖；商城编号作为隐藏属性和内部更新标识保留。重转旧版编号条目会替换为新名称。

不要覆盖已有工程的库表。模型使用 `kicad-embed://C编号.step` 资源相对引用，彩色 STEP 内嵌在封装中；独立文件也保存在 `LCSC.3dshapes`。搬移库后只需更新库表位置，无需修改逐颗模型路径，已放入 PCB 的模型随封装保存。

FreeCAD 导入与导出都保留逐面颜色，重新导入检查颜色、体积、实体数量与包围盒。之前已处理成白色的资源，在重新转换 KiCad 时会自动从保留的 `pcb_with_component.step` 恢复颜色；找不到原始文件的旧模型无法凭空恢复。普通磁盘相对路径在 KiCad 中依赖工程位置，因此采用原生资源相对引用以支持公共库与任意工程。

封装复用 KiCad 官方 EasyEDA Pro 导入器；符号由应用解析原始 JSON Lines 并生成。生成后使用 KiCad CLI 再次解析，核对引脚和焊盘编号、数量、位置、常规焊盘尺寸、贴片/通孔类型及钻孔。单层 SMD 的微小占位孔在导入前去除，真实通孔保留。

转换使用本批自动下载的原始符号、封装及独立 STEP。未知符号图元、缺失关联、编号不一致会报错，批量任务继续处理其他器件；不会静默生成缺引脚的库。原库没有定义的引脚电气类型保持 unspecified，需按数据手册完善 ERC。复杂符号的文字字体、椭圆等外观可能与原库不同；器件模型与焊盘的物理对齐仍需在 KiCad 3D 查看器中检查。

## 开发与验证

`npm test` 运行常规回归；设置 `HUB_KICAD_CLI` 后运行 `node --test tests/kicad.test.cjs`，可验证真实的贴片电容、通孔蜂鸣器和 20 引脚 IC。`electron . --kicad-smoke` 在隐藏的隔离实例中验证完整下载接收、FreeCAD 提取、原生库生成、自定义完成提示和临时文件清理。无需打开或修改用户已有 KiCad 工程。

## 转换为 Cadence

在设置 → Cadence 中选择 `SPB_25.1` 等安装目录、固定的库导出目录和库名称，默认 `LCSC`。自动查找 C / D / E 盘常见 Cadence 目录、Program Files 和用户 Programs 目录，优先较新的完整 SPB 安装。设置和使用引导中可点击「自动检测」重新查找。需要完整安装 Capture 与 Allegro，并有可用的 Allegro 封装编辑器许可证。转换使用独立无界面进程，不操作用户已打开的工程。当前原生验证版本为 25.1 S040。

在导出清单选择 Cadence 并开始导出，输出累计保存在同一目录：

- `LCSC.olb`：按元件型号命名的 Capture 原理图库，PCB Footprint 已绑定封装。
- 原始封装名称对应的 `.dra` / `.psm`、共享 `.pad`、异形焊盘的 `.ssm` 和同名彩色 `.step`。Allegro 不允许的标点（包括名称中的小数点）替换为下划线；同名不同器件加型号后缀。
- `hub_cadence.json`：累计库管理索引；`conversion_report.json`：本批结果及需复核项；`使用说明.md`。

Capture 的 Place Part → Add Library 中添加 OLB。Allegro 的 User Preferences → Paths → Library 中将同一目录加入 **psmpath、padpath、steppath**。模型仅绑定相对文件名，移动整个库后更新这三个搜索目录即可。符号中的 PCB Footprint 填写原生封装名称，Cadence 不使用 KiCad 的「库名:封装名」格式。

保留原始单元、引脚编号和布局。Capture 框体使用原生空心轮廓，竖直引脚名称沿引脚方向旋转，水平引脚保持水平；后续成功导出会一并修正累计库中旧条目的显示样式。XML 转换和原生回读仅在临时目录内进行，导出目录只保存基础库、管理索引、转换报告和使用说明，不生成 DSN、引脚表或 XML 辅助文件。转换成功后会移除旧版本由本软件管理的这些辅助文件。生成后按安装版本的 olb.xsd 校验，并核查 OLB 的引脚、坐标、电气类型、图形及封装绑定；Allegro 重新打开 DRA 校验铜焊盘位置、旋转、形状、尺寸、圆孔、镀孔和相对 STEP 搜索。

支持矩形、圆形、长圆、圆角矩形、非圆椭圆、正多边形铜焊盘和圆形通孔；自定义实心轮廓支持直线、圆弧及三次贝塞尔曲线。异形焊盘生成内容命名的 `.ssm` 形状符号，随 `.pad`、`.dra`、`.psm` 一起保存到固定库目录；不要单独移动或删除形状文件。原生回读核对形状绑定、全部轮廓顶点、面积和引脚旋转。当前 Allegro 25.1 形状符号不能包含内部挖空，自定义铜焊盘的内孔或多个轮廓明确报错，不填实、不合并；阻焊/锡膏层内孔仍保留。常见封装轮廓、圆弧及文字也可转换。不支持的铜焊盘、孔形或图元明确失败，批量继续其他器件，保留已有库。文档层填充转为轮廓，曲线折线逼近误差不超过 0.002 mm；文字采用默认字体。阻焊和钢网开口暂采用铜焊盘尺寸，热焊盘需按项目规则补充。保留原库明确的引脚电气类型，未定义 ERC 映射为 Capture Passive，不按名称推断 Power；重复名称添加唯一后缀，物理编号保持原样。详细限制记录在报告中。

设置 `HUB_CADENCE_ROOT` 与 `HUB_FREECAD_PYTHON` 后运行 `node --test tests/cadence.test.cjs`，覆盖真实 IC、贴片/通孔、累计输出、失败保留、多单元原理图和库移动。`electron . --cadence-smoke` 验证生产 IPC、下载通知的不同先后顺序、原生导出、统一完成弹窗与临时文件清理。

其他验证：`npm run smoke`、`npm run typecheck:extension`、`npm run build:extension`；真实 FreeCAD ZIP 测试设置 `HUB_TEST_ZIP`。

`src/easyeda-library.cjs` 解析源库关联；`src/kicad-symbol.cjs` 生成符号；`src/kicad.cjs` 调用官方封装导入并校验、绑定模型；`tools/` 提取 STEP；`ui/` 应用界面；`src/easyeda/` EDA 任务逻辑；连接插件位于 `extensions/easyeda/`。

参考：[KiCad 9 CLI](https://docs.kicad.org/9.0/en/cli/cli.html)、[EasyEDA 格式说明](https://dev-docs.kicad.org/en/import-formats/easyeda/)、[KiCad 封装格式](https://dev-docs.kicad.org/en/file-formats/sexpr-footprint/)。


## 封装来源

导出清单可切换当前 EDA 的封装来源；设置 → KiCad / Cadence 分别保存各自的选择。默认仍使用立创封装。“EDA 本地库优先”扫描软件自带封装库，也可在设置中指定个人封装库目录。采用大小写、连接符归一化与常见别名（SOP/SOIC、C0603/smc0603 等），以及名称中包含的本体尺寸和间距筛选唯一候选，不按孔径或焊盘尺寸要求完全相同。

复制本地封装到最终导出库，原库不修改；3D 仍使用本批立创彩色 STEP。按编号焊盘做简单平移/旋转对齐，并检查两个方向的焊盘中心跨度（排距差异不得超过 0.15 mm），避免引脚间距相同但两排焊盘过近的 SOP8 被误用。保留本地封装的焊盘、孔径和制造设计。编号不对应、模型无法对齐、候选不唯一或本地库不可用时回退立创封装，原因记录在转换报告；报告 footprintSource / sourceFootprint 记录实际采用的来源。模型绑定为相对引用，移动整个导出库仍可使用。

这是名称匹配与模型对齐功能，不代替封装适用性审核。选择本地库后仍应在目标 EDA 内复核焊盘和模型。AD 支持从指定目录读取 .PcbLib 并以同样的名称及焊盘跨度检查选择封装。

`electron . --kicad-smoke --local-footprints`、`electron . --cadence-smoke --local-footprints` 在隐藏隔离实例中验证自带 0603 封装复用与立创 STEP 的完整导出。

每次导出会在目标库目录的 `export_logs` 文件夹保留独立 `.log` 日志，包含器件编号、处理阶段、封装回退提示和失败详情。导出清单的“查看导出日志”打开当前目标 EDA 最近一次日志，完成弹窗的“查看日志”打开本次日志。前置检查失败也记录；库目录无法写入时日志保存到应用 `data/export_logs`。日志使用 UTF-8，供系统文本编辑器打开。

连接插件 v0.5.4 开启 EDA 的高度自动建模：未绑定独立 3D 模型时，仍请求导出 STEP，并记录自动生成提示；有绑定模型的器件继续使用原模型。自动生成的实际几何仍经过 FreeCAD 提取校验。

Cadence 转换支持顶底层阻焊和锡膏层的实心 FILL 开口，保留内孔，并抑制对应贴片焊盘的默认开口叠加。曲线按最大 0.002 mm 误差近似，原生 Allegro 生成后回读开口数量、边界与内孔。

导出前按元件编号检查当前目标库：完整的符号、封装、模型已存在时跳过下载及转换，日志注明复用；只有部分文件存在时仅补齐缺失资源，已有符号、封装和 STEP 不覆盖。共享符号库需要加入新元件时仍合并保存。Cadence 缺少 PSM/PAD 时优先从已有 DRA 恢复。更换目标目录可重新生成元件。

## Cadence 重复引脚名称

不再读取电源名称匹配规则。保留源库明确的电气类型，未定义类型采用 Passive。同一器件的重复名称（包括不同单元）全部添加 `_1`、`_2`、`_3` 后缀；预先保留所有已有名称，若后缀冲突则使用 `__1`，仍冲突则继续增加下划线。唯一性检查忽略大小写；引脚物理编号、坐标及 NC 标记保持原样。

设置 → Cadence → 更新已有原理图库可恢复之前按名称修改的类型并处理重复名称，无需重新下载，仅更新本软件管理的 OLB。原始类型从管理索引的 powerPinBaseTypes 恢复，源库明确的 Power 仍保留；非常旧的库缺少原始类型记录时无法可靠推断，需重新导出。封装和模型保持原样。已放置器件需要在 Capture 中 Update Cache。旧的 cadence-power-pins.json 不再读取，也不再影响设置或导出。

## Altium Designer 库导出

在设置 → Altium Designer 中选择固定导出目录与库名称，再在导出清单中选择 Altium Designer。一键流程生成累计的 `<库名>.SchLib`、`<库名>.PcbLib`，按原始型号和封装名称命名，物理编号、多单元符号、电气类型和封装关联一并转换。STEP 原始彩色字节嵌入 PcbLib，另在同目录保留 STEP 和来源标记；移动库时不依赖临时目录或绝对模型路径。无需安装 AD 转换脚本，也不要求提供 AD 命令行程序路径；使用通用设置中的 FreeCAD Python 和工程内固定版本依赖。

可选“AD 本地库优先”，需指定含 .PcbLib 的目录（递归三层）；唯一名称候选通过焊盘编号、两方向跨度和旋转对齐检查后复制，原库不修改。不能匹配时回退立创封装，模型仍来自立创。当前直接读取 PcbLib，IntLib 请先在 AD 中提取为 PcbLib。

已有完整真实模型的器件跳过下载及转换。共享原始封装使用同一默认模型；高度占位模型标记保存在 hub_altium.json 和 STEP 同名 .json，再次导出可替换为真实模型，并同时更新 PcbLib 内嵌内容。保留已有 SchLib 符号和封装焊盘；缺失累计库文件时，从管理索引恢复全部条目，缺少必要源数据则报告失败。更改已有目录的库名称时需选择新目录，避免破坏原理图关联。

使用方式：在 AD 的 Libraries / File-based Libraries 中安装生成的 SchLib 与 PcbLib，或直接打开库文件。此功能提供基础库，不生成 PCB 工程或集成库 IntLib。新文件提交前回读二进制，验证引脚类型/单元/热点、焊盘尺寸/钻孔/镀铜、中文属性、封装关联和内嵌 STEP 内容；不支持的源图元明确报错，不输出删减后的器件。原理图图形坐标按 1 mil 取整；PCB 曲线按最大 0.002 mm 偏差折线近似。

实现使用项目已有 [altium-monkey](https://github.com/wavenumber-eng/altium_monkey) 2026.6.9（二进制读写，AGPL-3.0-or-later），第三方依赖及许可保存在 tools/ad_vendor。参考其 [PcbLib API 文档](https://github.com/wavenumber-eng/altium_monkey/blob/main/docs/pcblib.md)；代码按工程内固定版本接口适配。`HUB_FREECAD_PYTHON` 环境变量启用 `tests/altium.test.cjs` 的真实二进制回归；`electron . --altium-smoke` 在隔离隐藏实例验证完整导出流程。


### 导出可靠性

- 设置按「通用 / KiCad / AD / Cadence」分别保存和校验，其他分组的草稿会保留。
- 点击导出先检查目标库写入权限、已有库、FreeCAD、目标转换工具、立创 EDA 登录和插件连接。完整已有库可以离线复用。
- 清单显示每个失败项的原因，可单独重试；上次导出结果可展开查看成功项和提示。
- 进度覆盖立创 EDA 下载、FreeCAD 提取和库转换；中止会在当前元件完成后生效，保留已经完成的库。收尾提交完成后才解除锁定。
- 异常退出后恢复清单并标记中断；再次导出时检查已有库，跳过完整元件。新版转换锁会检查所属进程；未知旧版锁不会自动删除。
- 大清单自动按每批最多 50 个顺序下载、提取和转换，统一汇总结果；中止后不再开始下一批。
- 转换支持圆角/旋转符号矩形和自适应椭圆近似（源几何误差不超过 0.002 mm，Capture 仍受 10 mil 网格限制）。按照[立创专业版官方文件格式](https://prodocs.lceda.cn/cn/format/index/)处理 V2 数组源码，尚未支持的几何会明确报错。
- 有颜色的 STEP 保留面颜色；源 STEP 没有颜色时采用中性灰并写入诊断提示。中间下载和模型文件在正常结束或异常恢复后清理。

回归测试：`npm test`；原生转换测试可设置 `HUB_FREECAD_PYTHON`、`HUB_KICAD_CLI`、`HUB_CADENCE_ROOT` 后运行。`electron . --batch-smoke` 使用模拟立创 EDA 通信和真实 FreeCAD / KiCad，检查 50＋1 分批、失败保留、结果汇总及临时文件清理；不会操作用户已打开的网页。


### 精简器件属性

器件库只保留原生位号、数值/型号、描述、封装关联、数据手册，以及厂家名称、厂家料号（MPN）和立创编码（LCSC）。不逐项复制商城的电压、功率、精度、库存、价格等参数。

- KiCad：原生 `Value`、`Description`、`Datasheet`、`Footprint`；厂家/MPN/LCSC 默认隐藏。
- Capture：原生 `PartValue`、`Reference` 和 `PCB Footprint`，隐藏的厂家/MPN/LCSC/描述/Datasheet 属性。普通 OLB 的 Datasheet 是文本字段，不能仅凭字段保证点击打开；CIS 的浏览字段或额外脚本才提供相应入口。本工具不安装额外 Capture 脚本。
- AD：原生 Comment/Designator/Description 和封装模型关联，隐藏的厂家/MPN/LCSC；数据手册使用 `HelpURL`，支持 F1 / References → Help，不再重复添加普通 Datasheet 参数。

数值优先取立创器件源码的 `Value`（如 100nF、10kΩ），没有可用数值时使用厂家料号；库条目名称仍使用型号。已存在的完整库继续跳过，不自动覆盖。

Cadence 的 Value 另外使用保守的 ASCII 写法以兼容 Capture → Allegro 网表传递：50kΩ → 50k、10µF/10μF → 10uF、± → `_pm_`、% → `pct`、° → `deg`、/ → `_per_`；全角字符转为半角，空白及常见分隔符转为下划线。转换会记录日志，未知字符明确报错，避免静默改变含义。这些规则只作用于 Cadence Value，不修改中文描述、厂家料号、数据手册或其他 EDA 的数值。现有库和已放置器件需要自行修改 Value 或重新导出后更新，完整库的跳过规则仍有效。

参考：[KiCad 字段说明](https://docs.kicad.org/8.0/en/eeschema/eeschema.html)、[Altium HelpURL](https://www.altium.com/documentation/altium-designer/schematic/parameters)、[Capture Datasheet 技术说明](https://www.parallel-systems.co.uk/wp-content/uploads/2020/02/Viewing_Datasheets.pdf)。原生库回读会校验字段内容；浏览器是否成功打开远程数据手册仍取决于 URL 可用性及软件环境。

### 失败文件保留与 STEP 校验

旋转约定：提取 STEP 保留立创模型装配旋转，仅平移到封装原点和板顶安装面；不再次套用模型旋转。使用立创封装时绑定角度为 0。复用本地封装时按编号焊盘对齐，KiCad 模型参数角度取几何对齐角度的相反数（KiCad 原生模型变换应用负角度）；Cadence/AD 继续使用各自的绑定方式。已存在的完整库仍跳过，不自动覆盖旧模型绑定。

失败或部分失败的任务将整份临时目录归档到应用数据目录 `data/failed-exports`，保留原始 ZIP、提取结果、processing.log、尺寸校验 JSON 和 failure.json；完成提示与导出日志显示归档路径，目标库目录的 last_failure_files.json 也记录此路径。异常退出恢复同样归档原始文件。成功任务及没有错误的主动中止任务继续清理，归档文件不自动删除，可排查后手动清理。

STEP 重新导入后的外包尺寸绝对容差为 0.01 mm，详细记录导出前后尺寸、各项差值和最大差值；超过容差仍失败。实体有效性、实体数量、体积及颜色检查保持原样，不以尺寸容差跳过这些检查。

尺寸检查使用 FreeCAD `optimalBoundingBox(False, False)` 的精确曲面外包框，避免普通 BoundBox 对裁剪曲面控制点的过度包围导致误判。C2915308 的原始 STEP 纳入回归，校验安装面、高度、实体和颜色保留。

## 保留导出现场

网页导航：立创 EDA/立创商城的前进、后退、刷新和地址栏在插件未连接时也可使用。页面的 `beforeunload` 阻止离开时显示应用内确认，取消保留当前页面，确认仅允许本次导航；导出锁定期间继续禁止导航。“前往立创 EDA”从其他页面切回现有工作区，已在立创 EDA 页面时打开编辑器首页。导航确认时临时隐藏原生网页视图，避免遮挡应用弹窗。可用 `npm run test:navigation` 执行隐藏窗口测试。

Cadence 转换支持同编号、同位置、同角度的跨层焊盘合并为单个 Padstack。多层焊盘提供钻孔及默认铜形状，顶/底层焊盘分别覆盖对应层铜形状，保留表面阻焊/锡膏开口；只生成一个引脚。原生回读校验各层形状、尺寸、孔径、镀孔及 STEP 关联。编号相同但位置/角度不同或存在同层重复图形时明确拒绝，避免丢失铜几何。C2915308 的当前系统库资源及同心自定义形状案例已验证 Allegro 25.1 的 DRA/PSM 编译与回读。

连接插件 0.5.8 起，按 C 编号查询显式使用 `getSystemLibraryUuid()` 返回的当前系统库，不再依赖 C 编号接口的隐式默认来源。返回其他库的记录会拒绝；必要时仅在指定系统库内搜索并核对供应商编号。批量任务遇到多个候选仍报错，不按封装名称猜选。导出日志中的 `lookup-library`、`lookup-source-rejected`、`lookup-candidates` 和 `lookup-selected` 记录来源库、候选及选中的器件/封装/模型 UUID。需重新导入 0.5.8 插件才能启用此修复；实际商城来源一致性应通过保留 PCB 对照确认。

设置 → 通用 → 保留导出 PCB（调试），默认关闭。开启并保存设置后，每个元件独立保存一张 `debug_C编号_时间戳_随机串` PCB 到立创 EDA 的 `lcsc-cadence-downloader` 工程。保存后不清空、不删除；中止时保留已处理元件，未开始元件不会创建 PCB。保存失败会停止任务并保留编辑现场，需要在立创 EDA 手动保存。关闭开关后的新任务恢复正常临时 PCB 清理，不会删除之前保留的调试 PCB。名称、UUID、保存状态记录在导出日志及 ZIP 的 batch_manifest.json，检查后请在立创 EDA 手动删除。需要导入连接插件 0.5.7 或更新版本。
