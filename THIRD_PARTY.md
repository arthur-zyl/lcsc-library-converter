# 资源与第三方依赖

本项目为独立开发工具。立创商城、立创 EDA、KiCad、Cadence、Altium 等名称归各自权利人所有。
原始元件符号、封装、商品资料及模型来源于立创商城和立创 EDA，项目代码许可证不替代这些资源各自的授权。
仓库中的少量元件文件仅用于兼容性回归测试，不构成完整元件库。

项目原创代码及随附立创 EDA 连接插件采用 **AGPL-3.0-or-later**。
打包依赖的原始许可证保留在安装目录的 Electron LICENSE / Chromium notices，以及 `resources/app/tools/ad_vendor/*.dist-info` 中。

主要依赖及来源：

| 依赖 | 版本 | 来源 / 许可证 |
| --- | --- | --- |
| Electron | 44.7.0 | https://github.com/electron/electron — MIT，另含 Chromium 等组件 notices |
| ws | 8.22.0 | https://github.com/websockets/ws — MIT |
| JSZip | 3.10.1 | https://github.com/Stuk/jszip — MIT / GPL-3.0 双许可证，使用 MIT 条款 |
| altium-monkey | 2026.6.9 | https://github.com/wavenumber-eng/altium_monkey — AGPL-3.0-or-later |
| wn-geometer | 2026.5.25 | https://github.com/wavenumber-eng/geometer — 以对应发布版本的上游许可证及 notices 为准 |
| freetype-py | 2.5.1 | https://github.com/rougier/freetype-py — 保留其发行包和 FreeType notices |
| lxml | 6.0.2 | https://github.com/lxml/lxml — BSD-3-Clause 及附带组件 notices |
| lz4 | 4.4.5 | https://github.com/python-lz4/python-lz4 — BSD 及 LZ4 notices |
| Pillow | 11.2.1 | https://github.com/python-pillow/Pillow — MIT-CMU 及附带组件 notices |
| uharfbuzz | 0.56.3 | https://github.com/harfbuzz/uharfbuzz — Apache-2.0 及 HarfBuzz notices |

Python 依赖固定在 `tools/requirements-ad.txt`；Node 依赖锁定在 `package-lock.json`。
项目对应版本源码使用 GitHub Release 自带的 Source code 下载项；发布说明提供 AD 依赖对应源码下载链接，文件保存在仓库的 `release-support` 分支。Python 依赖的 Python 源码和许可证也随软件分发。
