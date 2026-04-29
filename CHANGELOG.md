# Changelog

All notable user-facing changes to VoxType will be documented in this file.

This file is maintained by Release Please from Conventional Commits. Internal planning updates live in `planning/changelog.md`.

## [0.3.2](https://github.com/phob/VoxType/compare/voxtype-v0.3.1...voxtype-v0.3.2) (2026-04-29)


### Bug Fixes

* **ci:** upload release checksums ([0db0df7](https://github.com/phob/VoxType/commit/0db0df7e924108c04d1408bfb6f77f445af2ced9))
* **whisper:** combine generated and override prompts ([30956c3](https://github.com/phob/VoxType/commit/30956c358aa0d8c35f3910c3fd68d30af10703be))

## [0.3.1](https://github.com/phob/VoxType/compare/voxtype-v0.3.0...voxtype-v0.3.1) (2026-04-28)


### Bug Fixes

* **ci:** disable electron-builder publishing ([126f26c](https://github.com/phob/VoxType/commit/126f26c18d07744fbd3f4ab61cf256685f84e8c8))

## [0.3.0](https://github.com/phob/VoxType/compare/voxtype-v0.2.0...voxtype-v0.3.0) (2026-04-28)


### Features

* add microphone coordination modes ([8e33ba0](https://github.com/phob/VoxType/commit/8e33ba04e1988ddd36b4d3c2f77cd8e3f6c610f1))
* **audio:** add Silero VAD silence trimming ([a0b5675](https://github.com/phob/VoxType/commit/a0b5675482c7bf4f4a4f164c062d0a5ae55008c6))
* **audio:** mute system audio during recording ([6b439c9](https://github.com/phob/VoxType/commit/6b439c98c6327769aa28a2020747122971c5d410))
* **dictation:** add global hotkey target paste flow ([f8e194a](https://github.com/phob/VoxType/commit/f8e194a4e451cbe463ca648ed44f5299a436776f))
* **dictation:** add GPU runtimes and release overlay ([98fb118](https://github.com/phob/VoxType/commit/98fb11838c7c49f8248cf896195831bfaaa19cd4))
* **dictation:** add phase 1 local transcription workflow ([8d02e47](https://github.com/phob/VoxType/commit/8d02e472387570fe67371dfc2888bdf5c8f65ae9))
* **dictionary:** add local correction memory ([03de91b](https://github.com/phob/VoxType/commit/03de91bd95fec4ef22a063a3a092b7e099c7fb3d))
* **dictionary:** edit entries from table ([03ad23a](https://github.com/phob/VoxType/commit/03ad23ad61e6281e3f0bf01ebbd99318a24720be))
* **history:** add transcript audio playback ([7d56ce6](https://github.com/phob/VoxType/commit/7d56ce6a665ec25c095d281ba9554ebafbdf3a92))
* **hotkeys:** capture key combinations in settings ([b42b0bf](https://github.com/phob/VoxType/commit/b42b0bf11ebe9196979aea014e44c9b7b1637c5c))
* **hotkeys:** make global shortcuts configurable ([2750cc6](https://github.com/phob/VoxType/commit/2750cc6b0fd28c50dc476c464b7eebd16bf1c7a4))
* **insertion:** add insertion test panel ([5b42a08](https://github.com/phob/VoxType/commit/5b42a08e84f3b4ee40a0c81460e4946ac337e7ec))
* **insertion:** add remote clipboard mode ([c80e9f3](https://github.com/phob/VoxType/commit/c80e9f3a580b2adfacdb1bb3bef3bc6672b41fa1))
* **insertion:** add unicode keyboard typing modes ([ed1e5c7](https://github.com/phob/VoxType/commit/ed1e5c79ab02e26ecf81ebde10fff58aa1767569))
* **insertion:** add Windows Messaging mode ([8ec7bb4](https://github.com/phob/VoxType/commit/8ec7bb43b67334ae012dce3dc1192273dde7d158))
* **insertion:** paste transcript into active app ([60126a5](https://github.com/phob/VoxType/commit/60126a559e38920365eefbc1507e441ccc5527a4))
* **ocr:** add native Windows OCR ([212dbf5](https://github.com/phob/VoxType/commit/212dbf5c9d02eb92cd9e9b9ca3a432b0119e2a01))
* **ocr:** add screen-aware dictation context ([007501e](https://github.com/phob/VoxType/commit/007501e87eb10a27f8b6b21ffd67801edeff35ba))
* **overlay:** add compact canvas input meter ([27c6b0a](https://github.com/phob/VoxType/commit/27c6b0a8d5b771641206ae9e6278d3a071229d0b))
* **overlay:** refine recording waveform ([1ec303f](https://github.com/phob/VoxType/commit/1ec303fa35c2724ee03e5c40e628b965ee642a7e))
* **profiles:** add automatic per-app profiles ([6983a45](https://github.com/phob/VoxType/commit/6983a4590966ad66fff7b994b1d0fb0038458ce8))
* recreate release UI with VoxType logo ([25a18c9](https://github.com/phob/VoxType/commit/25a18c9953a17a45365e7c82b34a97d3b8b7295d))
* **release:** prepare first GitHub release ([ef100e7](https://github.com/phob/VoxType/commit/ef100e749908b18d816483a88cbcbd33e262ae1d))
* **runtime:** add first-run CUDA setup ([eba6a1b](https://github.com/phob/VoxType/commit/eba6a1b275be33a4f912b749e59ca68475b84b0a))
* **runtime:** add managed whisper.cpp runtime install ([22ecdb5](https://github.com/phob/VoxType/commit/22ecdb58eb78673dd64e92225dff0a5d96965c1e))
* **settings:** tune remote clipboard paste delay ([6fdf474](https://github.com/phob/VoxType/commit/6fdf474bab28d7bca8246de48f971cfb0c8c2c2a))
* **ui:** add release component system ([07e78e3](https://github.com/phob/VoxType/commit/07e78e3923357858ea505cbdda20b45a7c1e8737))
* **ui:** add release dictionary tab ([0b77ebc](https://github.com/phob/VoxType/commit/0b77ebc4da8674e007bd9f0f70d30fc4074154a9))
* use lucide-react icons across the UI ([a799c71](https://github.com/phob/VoxType/commit/a799c719cd60bf4edbdcf8706a66d418458ad044))
* **windows:** add native helper active window detection ([faf48e3](https://github.com/phob/VoxType/commit/faf48e395060158f8f3c977053862536bea5aa98))


### Bug Fixes

* **audio:** harden renderer microphone capture ([76a19a3](https://github.com/phob/VoxType/commit/76a19a3739240d2bc56281d222393aac6414b80a))
* **audio:** move Silero VAD into native helper ([68c8941](https://github.com/phob/VoxType/commit/68c8941045be1a41f03b01c9014c3ad0b555cf03))
* **audio:** preserve signed native samples ([24f314a](https://github.com/phob/VoxType/commit/24f314a454ba8f08183de4e6629c0fa503718026))
* **audio:** record through native windows helper ([a91bfb5](https://github.com/phob/VoxType/commit/a91bfb5b74c4635a37402751e792ef72ae7a42c9))
* **audio:** smooth VAD trimmed audio joins ([58f83d3](https://github.com/phob/VoxType/commit/58f83d39e31267cde60314b443cfc63d8413c08a))
* **audio:** use audio worklet recorder ([92d2e26](https://github.com/phob/VoxType/commit/92d2e26f0bd2147c5b11d72cf2cbb867896bbd71))
* **audio:** use conservative VAD edge trimming ([68adf4c](https://github.com/phob/VoxType/commit/68adf4cac9375fa8c151efc538c524c7db1067fa))
* **insertion:** default remote apps to chunked ([459cdf5](https://github.com/phob/VoxType/commit/459cdf557e8ad3f2273b04b3ff2c970fc7c28e0a))
* **insertion:** prefer focused message target ([1276805](https://github.com/phob/VoxType/commit/1276805f4e0be17466f4340acd5e6b1e14e33d57))
* **insertion:** restore clipboard after paste ([ff742ad](https://github.com/phob/VoxType/commit/ff742ad1df7b64b711e679e61ef5d9419988d474))
* **insertion:** target remote windows for messaging ([a4f70d5](https://github.com/phob/VoxType/commit/a4f70d5e12dd50f438810c1408f5fbdf5e98e6a9))
* **insertion:** use Electron clipboard for paste ([5468747](https://github.com/phob/VoxType/commit/5468747d3da3af726374c0d1b06b94e55b2c1b54))
* **runtime:** pass archive paths safely to powershell ([db3d182](https://github.com/phob/VoxType/commit/db3d182a97b2c71fa10e0b74a541a7eb7fc07541))
* support ScrollLock recording hotkey ([32e660c](https://github.com/phob/VoxType/commit/32e660c905219db9a4423edd74ae3d5d2737eb70))
* **windows:** preserve maximized target windows ([9cf0c19](https://github.com/phob/VoxType/commit/9cf0c19bac13cb5ad4c01f8951d702cea7a7a80a))

## [0.2.0](https://github.com/phob/VoxType/compare/voxtype-v0.1.0...voxtype-v0.2.0) (2026-04-24)


### Features

* **settings:** add persistent app settings foundation ([9d8151a](https://github.com/phob/VoxType/commit/9d8151ae7bb7ca3b72edbf83ee5cdf5c60746807))

## 0.1.0 - 2026-04-24

### Added

- Added the initial Electron, React, and TypeScript app scaffold.
- Added the first VoxType status screen and tray setup.
- Added planning documents for the product vision, architecture, models, dictionary/context behavior, Windows insertion, roadmap, and release strategy.
