# EDA Component Hub · EDA 元件资源库

Windows Electron 应用：内嵌立创商城选料，连接 EasyEDA Pro 导出原始库，通过 FreeCAD 提取独立 STEP，再转换为目标 EDA 库。目前支持 KiCad、Cadence Capture / Allegro 以及 Altium Designer 原生元件库。

## 从 Git 获取源码后

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

构建完成后执行 `npm test` 验证，双击 `Start.vbs` 启动。插件安装包由 `npm run build:extension` 生成到 `dist`。

## 启动与导出

双击 `Start.vbs`，或执行 `npm start`。首次安装依赖执行 `npm ci`。

首次启动会显示使用引导：

- **准备 FreeCAD**：从官网下载并安装 Windows 版本，或选择已有安装的 `bin/python.exe`。软件会查找常见安装目录，实际检测 FreeCAD、Part 和 Import 模块及实体建模。不能选择系统 Python 或 FreeCAD.exe。
- **配置目标库**：先选择一种 EDA、固定导出目录和库名称。KiCad 检查 CLI 版本；Cadence 检查完整 SPB 工具；AD 检查 Python 3.11 与本软件的转换依赖。不会要求先安装所有 EDA。
- **连接立创 EDA**：登录个人账号，复制插件文件夹并导入连接插件，开启外部交互权限。账号登录和插件连接分别显示状态。打开 EDA 操作后，点击顶部「返回使用引导」继续。

首次显示后即记住引导已展示，后续启动不会重复弹出；「稍后配置」可先浏览商城，再通过设置页手动继续。旧版本已有配置的用户升级后也不会自动弹出。完成状态与展示状态分别保存。设置页的「使用引导」可随时重新配置，已有路径会预填。下载按钮使用系统浏览器打开官方网页，不会自动安装工具。


1. 在商城商品详情或搜索结果点击「加入清单」，按钮替换商城原购物车按钮。
2. 在 立创 EDA 工作区登录，安装 `dist/lcsc-cadence-downloader_v0.5.6.eext` 并开启外部交互权限。软件可复制插件所在文件夹。后续启动自动连接。
3. 在导出清单选择目标 EDA（KiCad / Cadence / Altium Designer），然后开始批量导出。应用锁定 EDA 操作、显示进度，允许请求中止；完成当前器件及清理后保存已导出的结果。个人专用工程保留，每批临时 PCB 删除。
4. 下载自动交给 FreeCAD 提取并校验独立 STEP，然后直接转换到目标 EDA 的固定库目录。整个过程保持锁定，转换和清理结束后统一弹窗，可打开最终库目录。中间 ZIP 与提取资源使用每批独立临时目录，任务收尾时删除；不再提供本地资源页或二次手动转换。
5. 设置页左侧按通用、KiCad、Altium Designer、Cadence 分组。通用组配置 FreeCAD Python 并提供连接故障排查；KiCad 组配置程序、库目录和封装库名称；Cadence 组配置 SPB 安装目录、库目录、Capture 库名称，以及电源引脚匹配规则、测试和已有库更新。切换分组保留未保存修改，保存统一提交配置。

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
- 原始封装名称对应的 `.dra` / `.psm`、共享 `.pad` 和同名彩色 `.step`。Allegro 不允许的标点（包括名称中的小数点）替换为下划线；同名不同器件加型号后缀。
- `hub_cadence.json`：累计库管理索引；`conversion_report.json`：本批结果及需复核项；`使用说明.md`。

Capture 的 Place Part → Add Library 中添加 OLB。Allegro 的 User Preferences → Paths → Library 中将同一目录加入 **psmpath、padpath、steppath**。模型仅绑定相对文件名，移动整个库后更新这三个搜索目录即可。符号中的 PCB Footprint 填写原生封装名称，Cadence 不使用 KiCad 的「库名:封装名」格式。

保留原始单元、引脚编号和布局。Capture 框体使用原生空心轮廓，竖直引脚名称沿引脚方向旋转，水平引脚保持水平；后续成功导出会一并修正累计库中旧条目的显示样式。XML 转换和原生回读仅在临时目录内进行，导出目录只保存基础库、管理索引、转换报告和使用说明，不生成 DSN、引脚表或 XML 辅助文件。转换成功后会移除旧版本由本软件管理的这些辅助文件。生成后按安装版本的 olb.xsd 校验，并核查 OLB 的引脚、坐标、电气类型、图形及封装绑定；Allegro 重新打开 DRA 校验铜焊盘位置、旋转、形状、尺寸、圆孔、镀孔和相对 STEP 搜索。

首版支持矩形、圆形、长圆铜焊盘和圆形通孔，常见轮廓、圆弧及文字。不支持的铜焊盘、孔形或图元明确失败，批量继续其他器件，保留已有库。文档层填充转为轮廓，曲线折线逼近误差不超过 0.002 mm；文字采用默认字体。阻焊和钢网开口暂采用铜焊盘尺寸，热焊盘需按项目规则补充。源库未定义或 Passive 的常见电源引脚（VDD、VDDIO、VSS、VCC、GND 等）映射为 Capture Power，保留原名及每个物理引脚编号；其他未定义 ERC 映射为 Capture Passive，来源为原始立创库而非数据手册核对，详细限制记录在报告中。

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

## Cadence 电源引脚规则

设置 → Cadence → 电源引脚识别使用多行通配符规则，每行一个名称或模式。`*` 匹配任意字符，`?` 匹配单个字符，`!` 开头排除，`#` 开头注释；忽略大小写、匹配完整名称，多行命中以最后一行为准。例如：

```text
# 补充电源名称
VCCO_*
CUSTOM_RAIL
# 排除检测和控制信号
!*_SENSE
!*_EN
```

常见电源名称已有内置识别。提供名称测试和恢复默认，保存到应用 data/cadence-power-pins.json 的 patterns 多行文本字段；界面显示实际路径。旧 JSON 正则配置可自动迁移；不能直接转换的自定义正则保留为兼容规则并在界面提示，新的多行规则可覆盖其结果。恢复默认并保存可移除旧规则。

原库明确的 Power 保留，输入输出和 NC 不按名称修改。只对 Passive / 未定义引脚补充 Power；记录原始类型，后续修改规则可恢复由规则改变的类型。旧版本没有原始类型记录的 Power 不自动降级。同名非 Power 引脚写入警告及物理编号，不能仅因为重名就当作电源。

保存后点击“更新已有原理图库”，无需重新下载即可按当前规则重新生成本软件管理的 OLB，并进行原生回读验证。保留 DRA、PSM、PAD 和 STEP，不处理未纳入 hub_cadence.json 的外部符号。Capture 工程内已放置器件需要使用 Update Cache 更新缓存。已有完整元件仍按原逻辑跳过下载；规则修复通过此按钮独立执行。


## Altium Designer 库导出

在设置 → Altium Designer 中选择固定导出目录与库名称，再在导出清单中选择 Altium Designer。一键流程生成累计的 `<库名>.SchLib`、`<库名>.PcbLib`，按原始型号和封装名称命名，物理编号、多单元符号、电气类型和封装关联一并转换。STEP 原始彩色字节嵌入 PcbLib，另在同目录保留 STEP 和来源标记；移动库时不依赖临时目录或绝对模型路径。无需安装 AD 转换脚本，也不要求提供 AD 命令行程序路径；使用通用设置中的 FreeCAD Python 和工程内固定版本依赖。

可选“AD 本地库优先”，需指定含 .PcbLib 的目录（递归三层）；唯一名称候选通过焊盘编号、两方向跨度和旋转对齐检查后复制，原库不修改。不能匹配时回退立创封装，模型仍来自立创。当前直接读取 PcbLib，IntLib 请先在 AD 中提取为 PcbLib。

已有完整真实模型的器件跳过下载及转换。共享原始封装使用同一默认模型；高度占位模型标记保存在 hub_altium.json 和 STEP 同名 .json，再次导出可替换为真实模型，并同时更新 PcbLib 内嵌内容。保留已有 SchLib 符号和封装焊盘；缺失累计库文件时，从管理索引恢复全部条目，缺少必要源数据则报告失败。更改已有目录的库名称时需选择新目录，避免破坏原理图关联。

使用方式：在 AD 的 Libraries / File-based Libraries 中安装生成的 SchLib 与 PcbLib，或直接打开库文件。此功能提供基础库，不生成 PCB 工程或集成库 IntLib。新文件提交前回读二进制，验证引脚类型/单元/热点、焊盘尺寸/钻孔/镀铜、中文属性、封装关联和内嵌 STEP 内容；不支持的源图元明确报错，不输出删减后的器件。原理图图形坐标按 1 mil 取整；PCB 曲线按最大 0.002 mm 偏差折线近似。

实现使用项目已有 [altium-monkey](https://github.com/wavenumber-eng/altium_monkey) 2026.6.9（二进制读写，AGPL-3.0-or-later），第三方依赖及许可保存在 tools/ad_vendor。参考其 [PcbLib API 文档](https://github.com/wavenumber-eng/altium_monkey/blob/main/docs/pcblib.md)；代码按工程内固定版本接口适配。`HUB_FREECAD_PYTHON` 环境变量启用 `tests/altium.test.cjs` 的真实二进制回归；`electron . --altium-smoke` 在隔离隐藏实例验证完整导出流程。
