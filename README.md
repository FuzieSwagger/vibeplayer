# M'uzie — spatial cassette deck

Локальный музыкальный плеер, который выглядит как кассетный магнитофон 80-х, а
звучит как настоящая комната: колонку можно перетаскивать мышкой, и звук честно
следует за ней — уходит влево, вправо, вдаль и становится глуше.

Чистый HTML5, CSS3 и Vanilla JavaScript. Никаких библиотек, CDN, сборки и
загрузки файлов на сервер: музыка остаётся на устройстве.

[![Live Demo](https://img.shields.io/badge/demo-live-b18cff?style=flat-square&labelColor=070610)](https://fuzieswagger.github.io/vibeplayer/)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)](#)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)](#)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](#)
[![Web Audio API](https://img.shields.io/badge/Web%20Audio-PannerNode-8ef0ff?style=flat-square&labelColor=070610)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[**Открыть демо →**](https://fuzieswagger.github.io/vibeplayer/)

[![Превью M'uzie](assets/preview.webp)](https://fuzieswagger.github.io/vibeplayer/)

## Возможности

- **Загрузка музыки** — скрытый `<input type="file" accept="audio/*" multiple>`,
  кнопка «Загрузить музыку» и drag-and-drop по всему окну.
- **Плейлист** — название, формат и размер файла, подсветка активного трека,
  эквалайзер у играющего, удаление отдельного трека и очистка всего списка.
- **Транспорт** — play/pause, следующий и предыдущий трек, автопереход в конце
  трека.
- **Прогресс-бар** — кастомный слайдер с текущим временем и длительностью:
  клик или перетаскивание меняет позицию.
- **Громкость** — ползунок, mute и запоминание уровня в `localStorage`.
- **Кассета** — при воспроизведении катушки крутятся, на ленте появляется
  название трека.
- **Комната звука** — вид сверху, слушатель в центре, колонку можно тащить
  мышкой, пальцем или стрелками клавиатуры.
- **Живой визуализатор** — радиальная роза на Canvas, которая строится по
  реальному спектру через `AnalyserNode`.
- **Обработка ошибок** — не-аудио файлы, битые файлы, заблокированный автоплей и
  отсутствие Web Audio не ломают интерфейс.

## Как работает пространственный звук

Аудиограф собирается один раз при первом воспроизведении:

```
<audio> → MediaElementSource → PannerNode (HRTF)
        → BiquadFilter (lowpass) → GainNode → AnalyserNode → destination
```

- **Панорама.** `PannerNode` с моделью `HRTF` получает координаты колонки.
  Слушатель стоит в центре комнаты, поэтому смещение влево/вправо даёт разницу
  между ушами.
- **Расстояние.** Комната — 9 × 7 метров. Позиция колонки переводится в
  координаты `x ∈ [−4.5, 4.5]`, `z ∈ [−3.5, 3.5]`; дальше работает
  `distanceModel: "inverse"` (`refDistance: 1.5`, `rolloffFactor: 1.2`).
- **Глухость.** Одновременно с расстоянием закрывается lowpass-фильтр:

  ```js
  const falloff = Math.min(distance / 5.5, 1);
  const cutoff = 19000 * Math.pow(0.028, falloff);
  ```

  Вблизи срез почти не слышен (~19 кГц), в углу комнаты звук становится глухим
  (~500 Гц). Поэтому «отвёл колонку далеко» слышно, а не только видно.
- **Плавность.** Координаты и срез обновляются через `setTargetAtTime`, так что
  при перетаскивании нет щелчков и ступенек.

## Управление

| Действие | Результат |
| --- | --- |
| Перетащить колонку в комнате | Меняет панораму, дистанцию и тембр |
| `Space` | Play / pause |
| `←` / `→` | Перемотка на 5 секунд |
| `↑` / `↓` | Громкость ±5% |
| Стрелки на колонке | Двигают колонку по комнате |
| `Home` на колонке | Возвращает колонку в центр |
| Клик по треку | Воспроизвести его |
| `×` у трека | Удалить трек из плейлиста |
| «Очистить» | Очистить плейлист |

## Технологии

- **HTML5 Audio** — `MediaElementSource`, `timeupdate`, `loadedmetadata`,
  `ended`, `error`.
- **Web Audio API** — `PannerNode`, `BiquadFilterNode`, `GainNode`,
  `AnalyserNode`, `AudioContext`.
- **Canvas 2D** — радиальный спектр с зеркальной раскладкой и адаптацией под
  срез фильтра.
- **CSS3** — `backdrop-filter: blur(15px)`, кастомные свойства, Grid/Flexbox,
  анимации катушек и волн, `prefers-reduced-motion`.
- **Vanilla JavaScript (ES6+)** — состояние, события, pointer capture,
  `URL.createObjectURL`, `localStorage`.

Ключевые функции в `script.js`: `initPlayer()`, `playTrack()`, `togglePlay()`,
`updateProgress()`, `initVisualizer()`, а также `initRoom()` и `updateSpatial()`
для пространственной сцены.

## Структура проекта

```
.
├── assets/
│   ├── favicon.svg   # иконка сайта
│   ├── og.png        # превью для соцсетей 1200×630
│   └── preview.webp  # превью для README
├── index.html        # разметка комнаты, кассеты и плейлиста
├── style.css         # стекло, аврора, кассета, адаптив
├── script.js         # Web Audio, плейлист, drag & drop, визуализатор
├── LICENSE           # MIT
└── README.md
```

## Запуск локально

Откройте `index.html` в браузере — сборка не нужна. Для проверки drag-and-drop и
Web Audio удобнее локальный сервер:

```bash
python -m http.server 8000
# или
npx serve .
```

Затем откройте `http://localhost:8000`.

> Браузеры запускают `AudioContext` только после действия пользователя, поэтому
> первый трек начинает играть после клика по кнопке play или по треку.

## Поддержка браузеров

Нужен браузер с Web Audio API: Chrome, Edge, Firefox, Safari. Если Web Audio
недоступен или контекст не удалось создать, плеер продолжает работать в обычном
стерео, а в комнате появляется предупреждение.

Форматы (MP3, WAV, OGG, FLAC, M4A, AAC) зависят от браузера: файл выбирается по
`accept="audio/*"`, а неподдерживаемый кодек покажет понятный тост вместо
молчаливого отказа.

## Приватность

Файлы не загружаются никуда: используются только `URL.createObjectURL` и
локальный аудиограф. Нет запросов, аналитики, cookies и внешних шрифтов. В
`localStorage` хранится только уровень громкости.

## Дизайн

| Токен | Значение | Назначение |
| --- | --- | --- |
| `--bg` | `#070610` | фон |
| `--cyan` | `#8ef0ff` | акцент, спектр |
| `--violet` | `#b18cff` | градиенты, панели |
| `--pink` | `#ff8ad4` | колонка, тёплый акцент |
| `--radius` | `20px` | скругления панелей |

Стеклянные панели с `backdrop-filter: blur(15px)`, аврора из трёх размытых сфер,
зерно поверх фона и кассета с настоящими катушками. На экранах ≤1024px интерфейс
перестраивается в одну колонку.

## Авторы

- **fuzie** ([FuzieSwagger](https://github.com/FuzieSwagger)) — идея, дизайн,
  разработка.

## Лицензия

[MIT](LICENSE) © 2026 fuzie
