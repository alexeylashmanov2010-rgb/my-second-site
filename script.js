/* ==========================================================
   3D-модель MonsGeek M1 V5 на Three.js
   ----------------------------------------------------------
   Что делает этот файл:
   1. Загружает библиотеку Three.js.
   2. Собирает из простых фигур клавиатуру (9 слоёв) и коробку
      с ложементом и комплектом внутри.
   3. Каждый кадр смотрит, насколько прокручена секция,
      и по этому числу (от 0 до 1) двигает слои, камеру и коробку.
   4. Даёт покрутить модель мышкой или пальцем.

   Если что-то пошло не так (нет WebGL, нет интернета,
   человек просит меньше движения) — скрипт просто ничего
   не делает, и остаётся CSS-версия сайта.

   Единица длины в модели = ширина одной клавиши (примерно 19 мм).
   Оси: x — вправо, y — вверх, z — к пользователю.
   ========================================================== */

(function () {
  // Человек просит меньше движения — оставляем спокойную CSS-версию
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Проверяем, умеет ли браузер WebGL (3D-графику)
  const test = document.createElement("canvas");
  if (!(test.getContext("webgl2") || test.getContext("webgl"))) return show2d();

  // Загружаем Three.js и два дополнения к нему.
  // Адреса берутся из <script type="importmap"> в index.html.
  Promise.all([
    import("three"),
    import("three/addons/environments/RoomEnvironment.js"),
    import("three/addons/geometries/RoundedBoxGeometry.js"),
    document.fonts ? document.fonts.ready : Promise.resolve(),   // ждём шрифт Inter для надписей на клавишах
    loadTableImages(),                                             // картинки дерева из textures.js
  ])
    .then(([THREE, env, rounded, , wood]) => start(THREE, env.RoomEnvironment, rounded.RoundedBoxGeometry, wood))
    .catch((err) => {
      console.warn("3D не загрузился, остаётся CSS-версия:", err);
      show2d();
    });

  // Текстуры стола лежат в textures.js как data-URL. Превращаем их в готовые картинки.
  function loadTableImages() {
    const src = window.TABLE_TEXTURES;
    if (!src) return Promise.resolve(null);
    const names = ["color", "rough", "normal"];
    return Promise.all(names.map((n) => {
      const img = new Image();
      img.src = src[n];
      return img.decode().then(() => img);
    })).then((imgs) => Object.fromEntries(names.map((n, i) => [n, imgs[i]])));
  }

  // 3D не получилось — показываем плоскую CSS-версию, которую прятали на время загрузки
  function show2d() {
    document.documentElement.classList.remove("loading-3d");
  }
})();


function start(THREE, RoomEnvironment, RoundedBoxGeometry, woodImages) {
  /* ========================================================
     НАСТРОЙКИ — их удобно менять
     ======================================================== */
  const ACCENT = 0x4cc9ff;         // акцентный голубой, как в CSS
  const SPREAD = 2.0;              // расстояние между слоями при разлёте (в клавишах)
  const SMOOTH = 0.12;             // плавность реакции на прокрутку (0.05 — очень плавно, 1 — сразу)
  const KB_IN_BOX = 0.6;           // во сколько раз клавиатура уменьшается в коробке

  // Этапы анимации (доли прокрутки секции: 0.1 = 10%)
  const T = {
    up: [0.02, 0.14],       // клавиатура взлетает со стола вверх, в темноту; камера летит за ней
    openStart: 0.13,        // слои начинают разъезжаться
    openStagger: 0.02,      // задержка между слоями
    openLen: 0.15,          // длительность разлёта одного слоя
    closeStart: 0.50,       // слои начинают съезжаться
    closeStagger: 0.015,
    closeLen: 0.10,
    back: [0.72, 0.82],     // клавиатура спускается к столу (там уже открытая коробка) и зависает над ней
    kbDown: [0.82, 0.88],   // клавиатура опускается в коробку
    lidClose: [0.89, 0.94], // крышка закрывается
  };
  const SKY = 55;           // на какую высоту взлетает клавиатура (в клавишах) — над стеной уже темно
  const HOVER = 7.5;        // на какой высоте она зависает над коробкой

  /* ========================================================
     ПОИСК ЭЛЕМЕНТОВ НА СТРАНИЦЕ
     ======================================================== */
  const section = document.querySelector(".explode");
  const stage = document.querySelector(".stage");
  const heroTitle = document.querySelector(".hero-title");
  const hint = document.querySelector(".drag-hint");
  const kit = document.querySelector(".kit");
  const kitTitle = kit.querySelector("h2");
  const kitItems = [...kit.querySelectorAll("li")];

  /* ========================================================
     РЕНДЕРЕР, СЦЕНА, КАМЕРА
     ======================================================== */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);  // прозрачный фон — сквозь него виден чёрный фон сайта
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvas = renderer.domElement;
  canvas.className = "scene3d";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "3D-модель клавиатуры MonsGeek M1 V5: при прокрутке слои разъезжаются, а потом клавиатура укладывается в коробку");
  stage.prepend(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);

  // Отражения «студии» — чтобы металл и пластик выглядели живыми
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  // Свет
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);   // основной свет сверху-слева
  sun.position.set(-8, 16, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(ACCENT, 0.7);     // голубая подсветка сзади
  rim.position.set(8, 30, -12);   // высоко сзади: подсвечивает края клавиатуры, но не бликует на столе
  scene.add(rim);

  // Корневая группа: её поворачиваем мышкой
  const root = new THREE.Group();
  scene.add(root);

  /* ========================================================
     РАСКЛАДКА 75% (82 клавиши), как на фото M1 V5:
     правая колонка (Home…End) и стрелки сдвинуты вправо на полклавиши,
     их отделяет от основного блока перемычка корпуса.
     Каждая клавиша: [x, ширина, надпись]
     ======================================================== */
  const ROWS = [
    { y: 0, keys: [[0, 1, "Esc"], [1.25, 1, "F1"], [2.25, 1, "F2"], [3.25, 1, "F3"], [4.25, 1, "F4"],
      [5.5, 1, "F5"], [6.5, 1, "F6"], [7.5, 1, "F7"], [8.5, 1, "F8"],
      [9.75, 1, "F9"], [10.75, 1, "F10"], [11.75, 1, "F11"], [12.75, 1, "F12"], [14, 1, "Delete"]] },
    { y: 1.25, keys: [...["` ~", "1 !", "2 @", "3 #", "4 $", "5 %", "6 ^", "7 &", "8 *", "9 (", "0 )", "- _", "= +"]
      .map((t, i) => [i, 1, t]), [13, 2, "⟵"], [15.5, 1, "Home"]] },
    { y: 2.25, keys: [[0, 1.5, "Tab"], ...["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[ {", "] }"]
      .map((t, i) => [1.5 + i, 1, t]), [13.5, 1.5, "\\ |"], [15.5, 1, "PgUp"]] },
    { y: 3.25, keys: [[0, 1.75, "Caps"], ...["A", "S", "D", "F", "G", "H", "J", "K", "L", "; :", "' \""]
      .map((t, i) => [1.75 + i, 1, t]), [12.75, 2.25, "Enter"], [15.5, 1, "PgDn"]] },
    { y: 4.25, keys: [[0, 2.25, "⇧ Shift"], ...["Z", "X", "C", "V", "B", "N", "M", ", <", ". >", "/ ?"]
      .map((t, i) => [2.25 + i, 1, t]), [12.25, 1.75, "⇧ Shift"], [14.5, 1, "↑"], [15.5, 1, "End"]] },
    { y: 5.25, keys: [[0, 1.25, "Ctrl"], [1.25, 1.25, "Win"], [2.5, 1.25, "Alt"], [3.75, 6.25, ""],
      [10, 1, "Ctrl"], [11, 1, "Fn"], [12, 1, "Alt"], [13.5, 1, "←"], [14.5, 1, "↓"], [15.5, 1, "→"]] },
  ];

  // Размеры корпуса: поля вокруг клавиш (слева, сверху, справа, снизу)
  const PAD = { l: 0.45, t: 0.45, r: 0.5, b: 0.5 };
  const CASE_W = PAD.l + 16.5 + PAD.r;   // 17.45
  const CASE_D = PAD.t + 6.25 + PAD.b;   // 7.2
  // Перевод из «клавишных» координат раскладки в координаты сцены (центр корпуса = 0, 0)
  const LX = (x) => PAD.l + x - CASE_W / 2;
  const LZ = (y) => PAD.t + y - CASE_D / 2;

  // Цвет верха кейкапов по рядам: сверху почти белые, книзу темнее (как на фото).
  // Бока кейкапов автоматически темнее верха.
  const ROW_COLORS = ["#dededb", "#d6d6d3", "#c4c4c2", "#adaeae", "#8b8d8f", "#66696c"];
  // Цвет надписей: на светлых — серые, на средних — тёмные, на тёмных — белые
  const LEGEND_COLORS = ["#8e9195", "#878a8e", "#3a3d41", "#2e3135", "#f1f1f1", "#f4f4f4"];
  // Скульптурный профиль: каждый ряд чуть по-своему наклонён и приподнят
  const ROW_TILT = [0.13, 0.09, 0.04, 0, -0.05, -0.08];
  const ROW_LIFT = [0.08, 0.06, 0.03, 0, 0, 0.02];

  const KEYS = [];
  ROWS.forEach((row, r) => {
    row.keys.forEach(([x, w, label]) => {
      KEYS.push({ w, row: r, label, cx: LX(x + w / 2), cz: LZ(row.y + 0.5) });
    });
  });
  const KNOB = { x: LX(16.0), z: LZ(0.5) };   // крутилка над правой колонкой

  /* ========================================================
     МАТЕРИАЛЫ
     ======================================================== */
  const M = {
    alu:      new THREE.MeshStandardMaterial({ color: 0x17181b, metalness: 0.65, roughness: 0.42 }),  // чёрный анодированный алюминий
    aluIn:    new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.6, roughness: 0.55 }),
    knob:     new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.9, roughness: 0.32 }),
    cap:      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68, envMapIntensity: 0.45, vertexColors: true }),
    housing:  new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.35, transparent: true, opacity: 0.88 }),
    housingB: new THREE.MeshStandardMaterial({ color: 0xe9eaeb, roughness: 0.5 }),
    stem:     new THREE.MeshStandardMaterial({ color: 0xc9d3db, roughness: 0.4 }),
    pin:      new THREE.MeshStandardMaterial({ color: 0xd8b26a, metalness: 1, roughness: 0.25 }),
    plate:    new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.42, transparent: true, opacity: 0.9 }),
    foam:     new THREE.MeshStandardMaterial({ color: 0xe7e4dd, roughness: 1 }),
    gasket:   new THREE.MeshStandardMaterial({ color: 0x8e959c, roughness: 0.65, transparent: true, opacity: 0.9 }),
    pcbEdge:  new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.6 }),
    pad:      new THREE.MeshStandardMaterial({ color: 0xc8a75a, roughness: 0.3, metalness: 1 }),
    led:      new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 2.2 }),
    chip:     new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.45 }),
    metal:    new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.28 }),
    stab:     new THREE.MeshStandardMaterial({ color: 0x3a3d41, roughness: 0.6 }),
    dampen:   new THREE.MeshStandardMaterial({ color: 0xcfccc4, roughness: 1 }),
    rubber:   new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.95 }),
    battery:  new THREE.MeshStandardMaterial({ color: 0x3b4a57, roughness: 0.5, metalness: 0.3 }),
  };

  /* ========================================================
     ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ФИГУР
     ======================================================== */

  // Плоская фигура «прямоугольник со скруглёнными углами» с центром в (cx, cz)
  function roundRect(w, d, r, cx = 0, cz = 0) {
    const s = new THREE.Shape();
    const x = cx - w / 2, y = -cz - d / 2;  // в фигуре ось Y смотрит «назад», поэтому минус
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r);
    s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d);
    s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  // Многоугольник по точкам [x, z] — для выреза в верхней части корпуса
  function polyPath(points) {
    const p = new THREE.Path();
    points.forEach(([x, z], i) => (i ? p.lineTo(x, -z) : p.moveTo(x, -z)));
    p.closePath();
    return p;
  }

  // «Выдавливаем» плоскую фигуру вверх на толщину h, начиная с высоты y0
  function slab(shape, h, y0, bevel = 0.02) {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: h - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
      bevelSegments: 2, curveSegments: 6,
    });
    g.rotateX(-Math.PI / 2);          // было «вперёд», стало «вверх»
    g.translate(0, y0 + bevel, 0);
    return g;
  }

  // Квадратные вырезы под каждую клавишу (для пластины и поролона)
  function addKeyHoles(shape, size) {
    KEYS.forEach((k) => {
      const x = k.cx - size / 2, y = -k.cz - size / 2;
      const h = new THREE.Path();
      h.moveTo(x, y); h.lineTo(x + size, y); h.lineTo(x + size, y + size); h.lineTo(x, y + size); h.closePath();
      shape.holes.push(h);
    });
    return shape;
  }

  // Много одинаковых деталей одним объектом (так быстрее): InstancedMesh.
  // items — массив позиций [x, y, z] или готовых матриц Matrix4.
  const _m = new THREE.Matrix4();
  function instanced(geo, mat, items, colorOf) {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.isMatrix4 ? it : _m.makeTranslation(it[0], it[1], it[2]));
      if (colorOf) mesh.setColorAt(i, new THREE.Color(colorOf(i)));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  function mesh(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  // Матрица положения кейкапа: сдвиг + наклон ряда
  function keyMatrix(k, extra) {
    const m = new THREE.Matrix4().makeTranslation(k.cx, 1.3 + ROW_LIFT[k.row], k.cz)
      .multiply(new THREE.Matrix4().makeRotationX(ROW_TILT[k.row]));
    return extra ? m.multiply(extra) : m;
  }

  /* ========================================================
     СЛОИ КЛАВИАТУРЫ (сверху вниз, как в подписях)
     Каждый слой — отдельная группа, её двигаем по высоте.
     anchor — точка, к которой ведёт линия подписи.
     ======================================================== */
  const keyboard = new THREE.Group();
  root.add(keyboard);
  const layers = [];
  function addLayer(group, anchor) {
    keyboard.add(group);
    layers.push({ group, anchor: new THREE.Vector3(...anchor) });
  }
  const RIGHT = CASE_W / 2;

  // ---------- 1. Кейкапы ----------
  {
    const g = new THREE.Group();
    const CAP_H = 0.55;

    // Форма кейкапа: скруглённый «кубик», который сужается кверху.
    // Вершинам задаём цвет: верх светлый, бока темнее книзу (двухцветный вид, как на фото).
    function capGeometry(w) {
      const geo = new RoundedBoxGeometry(w - 0.08, CAP_H, 0.92, 3, 0.07);
      const pos = geo.attributes.position, nor = geo.attributes.normal;
      const colors = [];
      for (let v = 0; v < pos.count; v++) {
        const t = (pos.getY(v) + CAP_H / 2) / CAP_H;         // 0 — низ, 1 — верх
        pos.setX(v, pos.getX(v) * (1 - t * (0.26 / w)));      // верх уже низа
        pos.setZ(v, pos.getZ(v) * (1 - t * 0.2) - t * 0.04);
        const f = nor.getY(v) > 0.6 ? 1 : 0.42 + 0.4 * t;     // бока темнее, особенно внизу
        colors.push(f, f, f);
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      geo.translate(0, CAP_H / 2, 0);
      return geo;
    }

    const byWidth = {};
    KEYS.forEach((k, i) => (byWidth[k.w] = byWidth[k.w] || []).push(i));
    Object.entries(byWidth).forEach(([w, ids]) => {
      g.add(instanced(capGeometry(Number(w)), M.cap, ids.map((i) => keyMatrix(KEYS[i])), (n) => ROW_COLORS[KEYS[ids[n]].row]));
    });

    // Надписи сбоку (на передней грани), как на настоящих кейкапах
    g.add(buildLegends(CAP_H));

    // Рисочки на F и J — чтобы найти клавиши вслепую
    const homing = KEYS.filter((k) => k.label === "F" || k.label === "J")
      .map((k) => keyMatrix(k, new THREE.Matrix4().makeTranslation(0, CAP_H + 0.005, 0.18)));
    g.add(instanced(new RoundedBoxGeometry(0.28, 0.025, 0.05, 1, 0.01), new THREE.MeshStandardMaterial({ color: 0xc4c4c2, roughness: 0.6 }), homing));

    addLayer(g, [RIGHT - 0.3, 1.6, 0]);
  }

  // Все надписи — одна общая картинка-«атлас» и по маленькому прямоугольнику на каждой клавише
  function buildLegends(capH) {
    const COLS = 8, CW = 256, CH = 64;
    const c = document.createElement("canvas");
    c.width = COLS * CW; c.height = Math.ceil(KEYS.length / COLS) * CH;
    const ctx = c.getContext("2d");
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    KEYS.forEach((k, i) => {
      if (!k.label) return;
      ctx.fillStyle = LEGEND_COLORS[k.row];
      ctx.font = `700 ${k.label.length > 4 ? 38 : 44}px Inter, Arial, sans-serif`;
      ctx.fillText(k.label, (i % COLS) * CW + CW / 2, Math.floor(i / COLS) * CH + CH / 2 + 2);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // Передняя грань кейкапа наклонена — ставим надпись на неё
    const zAt = (y) => { const t = y / capH; return 0.46 * (1 - 0.2 * t) - 0.04 * t; };
    const slope = Math.atan((zAt(0) - zAt(capH)) / capH);
    const qy = 0.22, qz = zAt(qy) + 0.008, qw = 0.84, qh = qw / 4;
    const local = new THREE.Matrix4().makeTranslation(0, qy, qz).multiply(new THREE.Matrix4().makeRotationX(-slope));

    const pos = [], uv = [], idx = [];
    const corner = new THREE.Vector3();
    KEYS.forEach((k, i) => {
      if (!k.label) return;
      const m = keyMatrix(k, local.clone());
      const u0 = (i % COLS) / COLS, u1 = u0 + 1 / COLS;
      const rows = c.height / CH;
      const v1 = 1 - Math.floor(i / COLS) / rows, v0 = v1 - 1 / rows;
      const base = pos.length / 3;
      [[-qw / 2, -qh / 2, u0, v0], [qw / 2, -qh / 2, u1, v0], [qw / 2, qh / 2, u1, v1], [-qw / 2, qh / 2, u0, v1]]
        .forEach(([x, y, u, vv]) => {
          corner.set(x, y, 0).applyMatrix4(m);
          pos.push(corner.x, corner.y, corner.z);
          uv.push(u, vv);
        });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.25, roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    return new THREE.Mesh(geo, mat);
  }

  // ---------- 2. Свитчи: верх, низ, шток-крестик и 5 ножек (5-pin) ----------
  {
    const g = new THREE.Group();
    const at = (y, dx = 0, dz = 0) => KEYS.map((k) => [k.cx + dx, y, k.cz + dz]);
    g.add(instanced(new RoundedBoxGeometry(0.72, 0.3, 0.72, 2, 0.05), M.housing, at(1.05)));    // верхняя крышка (прозрачная)
    g.add(instanced(new RoundedBoxGeometry(0.6, 0.22, 0.6, 1, 0.03), M.housingB, at(0.79)));    // нижняя часть (под пластиной)
    g.add(instanced(new THREE.BoxGeometry(0.18, 0.16, 0.05), M.stem, at(1.27)));                // крестик-шток
    g.add(instanced(new THREE.BoxGeometry(0.05, 0.16, 0.18), M.stem, at(1.27)));
    // ножки: две металлические + три пластиковых штырька
    const pinGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8);
    g.add(instanced(pinGeo, M.pin, at(0.62, -0.2, -0.12)));
    g.add(instanced(pinGeo, M.pin, at(0.62, 0.07, -0.26)));
    g.add(instanced(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 14), M.housingB, at(0.64)));
    const postGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8);
    g.add(instanced(postGeo, M.housingB, at(0.64, -0.27, 0)));
    g.add(instanced(postGeo, M.housingB, at(0.64, 0.27, 0)));
    addLayer(g, [RIGHT - 0.6, 1.05, 0]);
  }

  // ---------- 3. Ручка-энкодер: рифлёный цилиндр с фаской и кольцом на торце ----------
  {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.44, 0.46, 0.55, 96, 1);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {           // насечки по кругу
      const x = pos.getX(v), z = pos.getZ(v), r = Math.hypot(x, z);
      if (r > 0.43) {
        const k = 1 - 0.03 * (Math.sin(Math.atan2(z, x) * 48) > 0 ? 1 : 0);
        pos.setX(v, x * k); pos.setZ(v, z * k);
      }
    }
    geo.computeVertexNormals();
    g.add(mesh(geo, M.knob, KNOB.x, 1.78, KNOB.z));
    const ring = mesh(new THREE.TorusGeometry(0.3, 0.012, 8, 64), M.metal, KNOB.x, 2.056, KNOB.z);
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    addLayer(g, [KNOB.x + 0.46, 1.78, KNOB.z]);
  }

  // ---------- 4. Пластина из поликарбоната — с вырезами под свитчи ----------
  {
    const shape = addKeyHoles(roundRect(16.7, 6.45, 0.25), 0.72);
    addLayer(new THREE.Group().add(mesh(slab(shape, 0.08, 0.82, 0.01), M.plate)), [RIGHT - 0.4, 0.86, 0]);
  }

  // ---------- 5. Поролон пластины (PORON) ----------
  {
    const shape = addKeyHoles(roundRect(16.4, 6.2, 0.25), 0.8);
    addLayer(new THREE.Group().add(mesh(slab(shape, 0.16, 0.62, 0.02), M.foam)), [RIGHT - 0.55, 0.7, 0]);
  }

  // ---------- 6. Силиконовые гаскеты — подушки по краю пластины ----------
  {
    const g = new THREE.Group();
    const geoH = new RoundedBoxGeometry(1.2, 0.3, 0.34, 2, 0.12);
    const geoV = new RoundedBoxGeometry(0.34, 0.3, 1.1, 2, 0.12);
    [-6.3, -2.7, 1.0, 4.7].forEach((x) => [-3.22, 3.22].forEach((z) => g.add(mesh(geoH, M.gasket, x, 0.86, z))));
    [-8.35, 8.35].forEach((x) => g.add(mesh(geoV, M.gasket, x, 0.86, 0)));
    addLayer(g, [8.52, 0.86, 0]);
  }

  // ---------- 7. Печатная плата ----------
  {
    const g = new THREE.Group();
    const PW = 16.6, PD = 6.4;
    const pcbMat = new THREE.MeshStandardMaterial({ map: pcbTexture(PW, PD), roughness: 0.5, metalness: 0.2 });
    const board = mesh(slab(roundRect(PW, PD, 0.15), 0.06, 0.5, 0.005), [pcbMat, M.pcbEdge]);
    g.add(board);
    const top = 0.56;
    // контакты гнёзд hot-swap
    const padGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16);
    const pads = [];
    KEYS.forEach((k) => pads.push([k.cx, top, k.cz], [k.cx - 0.2, top, k.cz - 0.12], [k.cx + 0.07, top, k.cz - 0.26]));
    g.add(instanced(padGeo, M.pad, pads));
    // светодиоды «на юг» — ближе к пользователю, и диоды рядом с каждой клавишей
    g.add(instanced(new THREE.BoxGeometry(0.2, 0.04, 0.12), M.led, KEYS.map((k) => [k.cx, top + 0.02, k.cz + 0.3])));
    g.add(instanced(new THREE.BoxGeometry(0.1, 0.03, 0.05), M.chip, KEYS.map((k) => [k.cx + 0.33, top + 0.015, k.cz + 0.12])));
    // стабилизаторы длинных клавиш (на винтах к плате): две «лапки» и проволока
    KEYS.filter((k) => k.w >= 2).forEach((k) => {
      const off = k.w >= 6 ? 2.625 : 0.47;
      [-off, off].forEach((dx) => g.add(mesh(new RoundedBoxGeometry(0.28, 0.3, 0.42, 1, 0.04), M.stab, k.cx + dx, top + 0.15, k.cz)));
      const wire = mesh(new THREE.CylinderGeometry(0.018, 0.018, off * 2, 8), M.metal, k.cx, top + 0.06, k.cz - 0.24);
      wire.rotation.z = Math.PI / 2;
      g.add(wire);
    });
    // энкодер под ручкой: металлический корпус и вал
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.26, 0.5), M.metal, KNOB.x, top + 0.13, KNOB.z));
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 16), M.metal, KNOB.x, top + 0.6, KNOB.z));
    // разъём USB-C у задней кромки, переключатель режимов и микроконтроллер
    g.add(mesh(new RoundedBoxGeometry(0.5, 0.18, 0.4, 2, 0.06), M.metal, LX(1.2), top + 0.09, -PD / 2 + 0.22));
    g.add(mesh(new THREE.BoxGeometry(0.55, 0.14, 0.26), M.chip, LX(13.9), top + 0.07, -PD / 2 + 0.16));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.08, 0.08), M.metal, LX(13.95), top + 0.17, -PD / 2 + 0.12));
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), M.chip, LX(6.6), top + 0.02, LZ(1.12)));
    addLayer(g, [8.3, 0.53, 0]);
  }

  // Рисунок платы: дорожки, контуры посадочных мест (нарисовано на canvas)
  function pcbTexture(PW, PD) {
    const s = 120;                          // пикселей на одну клавишу
    const c = document.createElement("canvas");
    c.width = Math.round(PW * s); c.height = Math.round(PD * s);
    const x = c.getContext("2d");
    const X = (wx) => (wx + PW / 2) * s, Y = (wz) => (wz + PD / 2) * s;
    x.fillStyle = "#121518"; x.fillRect(0, 0, c.width, c.height);
    // дорожки: по рядам и по столбцам
    x.strokeStyle = "rgba(120,150,165,0.22)"; x.lineWidth = 3;
    ROWS.forEach((row) => {
      const y = Y(LZ(row.y + 0.5) + 0.38);
      x.beginPath(); x.moveTo(X(-PW / 2 + 0.3), y); x.lineTo(X(PW / 2 - 0.3), y); x.stroke();
    });
    KEYS.forEach((k) => {
      x.beginPath(); x.moveTo(X(k.cx + 0.4), Y(k.cz - 0.45)); x.lineTo(X(k.cx + 0.4), Y(k.cz + 0.1));
      x.lineTo(X(k.cx + 0.3), Y(k.cz + 0.2)); x.stroke();
    });
    // белые контуры посадочных мест
    x.strokeStyle = "rgba(235,240,245,0.35)"; x.lineWidth = 2;
    KEYS.forEach((k) => x.strokeRect(X(k.cx - 0.39), Y(k.cz - 0.39), 0.78 * s, 0.78 * s));
    // кромка платы
    x.strokeStyle = "rgba(200,170,90,0.4)"; x.lineWidth = 4;
    x.strokeRect(6, 6, c.width - 12, c.height - 12);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / PW, 1 / PD);   // у выдавленных фигур текстура ложится в координатах сцены —
    t.offset.set(0.5, 0.5);         // растягиваем её ровно на размер платы
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  // ---------- 8. Шумоизоляция под платой ----------
  {
    addLayer(new THREE.Group().add(mesh(slab(roundRect(16.5, 6.3, 0.2), 0.12, 0.32, 0.02), M.dampen)), [8.25, 0.38, 0]);
  }

  // ---------- 9. Алюминиевый корпус: нижняя половина + верхняя рамка ----------
  {
    const g = new THREE.Group();
    // Нижняя половина: дно и стенки (внутри — полость для платы и аккумулятора)
    g.add(mesh(slab(roundRect(CASE_W, CASE_D, 0.4), 0.25, 0, 0.04), M.alu));
    const lowRing = roundRect(CASE_W, CASE_D, 0.4);
    lowRing.holes.push(roundRect(CASE_W - 0.7, CASE_D - 0.65, 0.25));
    g.add(mesh(slab(lowRing, 0.4, 0.22, 0.03), M.alu));
    // Верхняя половина. Между половинами тонкий шов (зазор 0.02).
    // Вырез под клавиши повторяет фото: перемычка у правой колонки и площадка под ручку.
    const top = roundRect(CASE_W, CASE_D, 0.4);
    const e = 0.06;   // небольшой зазор вокруг кейкапов
    top.holes.push(polyPath([
      [LX(0) - e, LZ(0) - e], [LX(15) + e, LZ(0) - e], [LX(15) + e, LZ(4.25) - e],
      [LX(15.5) - e, LZ(4.25) - e], [LX(15.5) - e, LZ(1.25) - e], [LX(16.5) + e, LZ(1.25) - e],
      [LX(16.5) + e, LZ(6.25) + e], [LX(0) - e, LZ(6.25) + e],
    ]));
    g.add(mesh(slab(top, 0.86, 0.64, 0.045), M.alu));
    // «Ступенька» корпуса вокруг блока стрелок (между правым Shift и ↑, между Alt и ←)
    [[14, 4.25], [13, 5.25]].forEach(([x, y]) =>
      g.add(mesh(new THREE.BoxGeometry(0.5 - 2 * e, 0.3, 1), M.alu, LX(x + 0.25), 1.35, LZ(y + 0.5))));
    // Аккумулятор в нижней половине (под платой)
    g.add(mesh(new RoundedBoxGeometry(5.5, 0.12, 2.2, 2, 0.04), M.battery, 2.2, 0.31, 0.6));
    // Резиновые ножки снизу
    [[-6.9, -2.6], [6.9, -2.6], [-6.9, 2.6], [6.9, 2.6]].forEach(([x, z]) =>
      g.add(mesh(new RoundedBoxGeometry(0.35, 0.06, 1.6, 2, 0.03), M.rubber, x, -0.02, z)));
    // Сзади: порт USB-C и переключатель режимов (тёмные прорези)
    g.add(mesh(new RoundedBoxGeometry(0.62, 0.22, 0.05, 2, 0.1), M.rubber, LX(1.2), 0.62, -CASE_D / 2 - 0.005));
    g.add(mesh(new RoundedBoxGeometry(0.7, 0.16, 0.05, 2, 0.06), M.rubber, LX(13.95), 0.62, -CASE_D / 2 - 0.005));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), M.metal, LX(13.8), 0.62, -CASE_D / 2 - 0.02));
    addLayer(g, [RIGHT, 0.8, 0]);
  }

  /* ========================================================
     КОРОБКА: как у настоящей клавиатуры —
     жёсткие стенки, чёрный ложемент с выемкой под клавиатуру,
     отсек с комплектом, поролон и инструкция в крышке.
     ======================================================== */
  const BOX = { w: 12.4, d: 7.0, h: 1.6, t: 0.1 };
  const { w: BW, d: BD, h: BH, t: BT } = BOX;
  const box = new THREE.Group();
  root.add(box);
  const POCKET_Z = 1.0;          // выемка под клавиатуру — ближе к переднему краю
  const COMP_Z = -2.35;          // отсек с комплектом — у задней стенки

  // Фактура картона: еле заметные вертикальные полоски
  function cardboardTexture() {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = "#2b2d30"; x.fillRect(0, 0, 512, 64);
    x.fillStyle = "rgba(255,255,255,0.035)";
    for (let i = 0; i < 512; i += 6) x.fillRect(i, 0, 3, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const B = {
    card:   new THREE.MeshStandardMaterial({ map: cardboardTexture(), roughness: 0.9 }),
    cardIn: new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.95 }),
    insert: new THREE.MeshStandardMaterial({ color: 0x0f1011, roughness: 1 }),      // ложемент (плотный чёрный поролон)
    satin:  new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.35 }),   // лента, чтобы достать клавиатуру
    cable:  new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.55 }),
    lilac:  new THREE.MeshStandardMaterial({ color: 0xcfc3ea, roughness: 0.5 }),    // сиреневая ручка съёмника (как на фото)
    wire:   new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 1, roughness: 0.25 }),
    bag:    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.18 }),
  };

  // Нижняя часть коробки: дно и 4 стенки
  box.add(mesh(new THREE.BoxGeometry(BW, 0.12, BD), B.cardIn, 0, 0.06, 0));
  box.add(mesh(new THREE.BoxGeometry(BW, BH, BT), B.card, 0, BH / 2, BD / 2 - BT / 2));
  box.add(mesh(new THREE.BoxGeometry(BW, BH, BT), B.card, 0, BH / 2, -BD / 2 + BT / 2));
  box.add(mesh(new THREE.BoxGeometry(BT, BH, BD), B.card, BW / 2 - BT / 2, BH / 2, 0));
  box.add(mesh(new THREE.BoxGeometry(BT, BH, BD), B.card, -BW / 2 + BT / 2, BH / 2, 0));

  // Ложемент: лист плотного поролона с выемкой по форме клавиатуры и отсеком сзади
  {
    const iw = BW - BT * 2, id = BD - BT * 2;
    const shape = roundRect(iw, id, 0.05);
    const kbW = CASE_W * KB_IN_BOX + 0.18, kbD = CASE_D * KB_IN_BOX + 0.18;
    shape.holes.push(roundRect(kbW, kbD, 0.25, 0, POCKET_Z));
    shape.holes.push(roundRect(iw - 0.3, 1.75, 0.08, 0, COMP_Z));
    box.add(mesh(slab(shape, 0.83, 0.12, 0.03), B.insert));
    // Атласная лента под клавиатурой — за неё клавиатуру вытаскивают
    box.add(mesh(new THREE.BoxGeometry(0.45, 0.01, kbD - 0.1), B.satin, 3.6, 0.125, POCKET_Z));
    const tab = mesh(new THREE.BoxGeometry(0.45, 0.6, 0.012), B.satin, 3.6, 0.42, POCKET_Z + kbD / 2 - 0.04);
    tab.rotation.x = -0.25;
    box.add(tab);
    // Перегородки в отсеке
    [-2.25, 2.55].forEach((x) => box.add(mesh(new THREE.BoxGeometry(0.06, 0.78, 1.75), B.insert, x, 0.51, COMP_Z)));
  }

  // Комплект в отсеке
  {
    const y0 = 0.12;
    // Кабель: свёрнут кольцами, стянут липучкой, на концах USB-C и USB-A
    const coil = new THREE.TorusGeometry(0.62, 0.065, 12, 64);
    [0, 1, 2].forEach((i) => {
      const t = mesh(coil, B.cable, -4.1 + i * 0.05, y0 + 0.07 + i * 0.12, COMP_Z + i * 0.03);
      t.rotation.x = -Math.PI / 2;
      box.add(t);
    });
    box.add(mesh(new RoundedBoxGeometry(0.22, 0.46, 0.24, 2, 0.05), B.satin, -3.48, y0 + 0.2, COMP_Z));
    box.add(mesh(new RoundedBoxGeometry(0.42, 0.16, 0.2, 2, 0.05), B.cable, -4.75, y0 + 0.4, COMP_Z - 0.55));   // USB-C: корпус
    box.add(mesh(new RoundedBoxGeometry(0.2, 0.07, 0.14, 2, 0.03), M.metal, -5.03, y0 + 0.4, COMP_Z - 0.55));   //        штекер
    box.add(mesh(new RoundedBoxGeometry(0.5, 0.18, 0.24, 2, 0.05), B.cable, -3.55, y0 + 0.42, COMP_Z + 0.58));  // USB-A
    box.add(mesh(new THREE.BoxGeometry(0.3, 0.1, 0.2), M.metal, -3.15, y0 + 0.42, COMP_Z + 0.58));

    // Съёмник кейкапов: проволочная петля + сиреневая ручка с кольцом
    {
      const handleShape = roundRect(1.1, 0.48, 0.24);
      const hole = new THREE.Path(); hole.absarc(-0.3, 0, 0.13, 0, Math.PI * 2, true);
      handleShape.holes.push(hole);
      const handle = mesh(slab(handleShape, 0.06, 0, 0.015), B.lilac, -1.15, y0, COMP_Z - 0.3);
      handle.rotation.y = 0.12;
      box.add(handle);
      const loop = mesh(new THREE.TorusGeometry(0.3, 0.014, 6, 40, Math.PI * 1.6), B.wire, -0.25, y0 + 0.03, COMP_Z - 0.4);
      loop.rotation.x = -Math.PI / 2; loop.rotation.z = Math.PI * 0.7;
      box.add(loop);
    }
    // Съёмник свитчей: тонкая металлическая «пинцет-скоба»
    [-0.06, 0.06].forEach((a) => {
      const arm = mesh(new THREE.BoxGeometry(1.7, 0.02, 0.035), B.wire, 0.3, y0 + 0.02, COMP_Z + 0.45);
      arm.rotation.y = a;
      box.add(arm);
    });
    // Ресивер (донгл): чёрный корпус и металлический USB-штекер
    box.add(mesh(new RoundedBoxGeometry(0.26, 0.12, 0.2, 2, 0.04), B.cable, 1.85, y0 + 0.06, COMP_Z - 0.35));
    box.add(mesh(new THREE.BoxGeometry(0.22, 0.08, 0.18), M.metal, 2.05, y0 + 0.05, COMP_Z - 0.35));

    // Запасные свитчи в прозрачном пакетике
    [[3.45, -0.25, 0.3], [4.15, 0.2, -0.4], [4.85, -0.3, 0.9], [5.4, 0.25, 0.2]].forEach(([x, dz, ry]) => {
      const s = new THREE.Group();
      s.add(mesh(new RoundedBoxGeometry(0.44, 0.18, 0.44, 2, 0.03), M.housing, 0, 0.27, 0));
      s.add(mesh(new RoundedBoxGeometry(0.36, 0.14, 0.36, 1, 0.02), M.housingB, 0, 0.11, 0));
      s.add(mesh(new THREE.BoxGeometry(0.11, 0.1, 0.03), M.stem, 0, 0.4, 0));
      s.add(mesh(new THREE.BoxGeometry(0.03, 0.1, 0.11), M.stem, 0, 0.4, 0));
      s.position.set(x, y0, COMP_Z + dz);
      s.rotation.y = ry;
      box.add(s);
    });
    box.add(mesh(new RoundedBoxGeometry(2.8, 0.5, 1.45, 2, 0.12), B.bag, 4.4, y0 + 0.25, COMP_Z));
  }

  // Крышка. hinge — это «петля» на верхнем заднем ребре: крышку крутим вокруг неё
  const hinge = new THREE.Group();
  hinge.position.set(0, BH, -BD / 2 - 0.06);
  box.add(hinge);
  const LW = BW + 0.12, LD = BD + 0.12, LS = 0.6;   // размеры крышки и высота её бортика
  {
    const lidTopMat = new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.85 });
    loadLidTexture(lidTopMat);
    const lidMats = [B.card, B.card, lidTopMat, B.cardIn, B.card, B.card]; // стороны: +x, −x, верх, низ, перед, зад
    hinge.add(mesh(new THREE.BoxGeometry(LW, BT, LD), lidMats, 0, BT / 2, LD / 2));
    hinge.add(mesh(new THREE.BoxGeometry(LW, LS, BT), B.card, 0, -LS / 2 + BT, LD - BT / 2));          // бортик спереди
    hinge.add(mesh(new THREE.BoxGeometry(LW, LS, BT), B.card, 0, -LS / 2 + BT, BT / 2));               // сзади
    hinge.add(mesh(new THREE.BoxGeometry(BT, LS, LD), B.card, LW / 2 - BT / 2, -LS / 2 + BT, LD / 2)); // справа
    hinge.add(mesh(new THREE.BoxGeometry(BT, LS, LD), B.card, -LW / 2 + BT / 2, -LS / 2 + BT, LD / 2));// слева
    // Внутри крышки: мягкий поролон (защищает кейкапы) и вложенная инструкция
    hinge.add(mesh(new THREE.BoxGeometry(LW - 0.3, 0.08, LD - 0.3), B.insert, 0, -0.04, LD / 2));
    const guide = mesh(new THREE.PlaneGeometry(3.4, 2.4),
      new THREE.MeshStandardMaterial({ map: guideTexture(), roughness: 0.8, side: THREE.DoubleSide }), -2.6, -0.085, LD / 2 + 1.2);
    guide.rotation.x = Math.PI / 2;
    hinge.add(guide);
  }

  // Коробка стоит на столе. Она в той же группе, что и клавиатура (root),
  // поэтому при повороте мышкой они крутятся вместе — клавиатура не проходит сквозь коробку.
  box.position.y = -0.05;

  /* ========================================================
     СТОЛ И СТЕНА — настоящие 3D-объекты.
     Текстуры дерева и бетона рисуются кодом (функции ниже),
     поэтому они чёткие при любом размере экрана.
     ======================================================== */
  const room = new THREE.Group();
  scene.add(room);
  {
    const TABLE_TOP = -0.05;                     // поверхность стола = уровень ножек клавиатуры
    const WALL_Z = -11.5;                        // стена за столом (с запасом: клавиатура её не касается)
    // Столешница из отдельных досок ореха: у каждой своя высота, оттенок и рисунок,
    // между досками — настоящие щели, стыки досок идут вразбежку.
    const TW = 260, TD = 40;          // стол широкий и глубокий — края не видно даже на телефоне
    room.add(buildPlanks(TW, TD, TABLE_TOP, WALL_Z));

    // Стена: бетон. Кверху плавно темнеет и переходит в чёрный фон сайта
    const concrete = concreteTextures();
    const WW = 300, WH = 60;
    [concrete.color, concrete.bump].forEach((t) => t.repeat.set(WW / 16, WH / 16));
    const wallGeo = new THREE.PlaneGeometry(WW, WH, 1, 60);
    const cols = [];
    const wp = wallGeo.attributes.position;
    for (let v = 0; v < wp.count; v++) {
      const h = (wp.getY(v) + WH / 2) / WH;                 // 0 — низ стены, 1 — верх
      const k = Math.pow(1 - THREE.MathUtils.smoothstep(h, 0.08, 0.36), 1.4);
      cols.push(k, k, k);
    }
    wallGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const wall = mesh(wallGeo, new THREE.MeshStandardMaterial({
      map: concrete.color, bumpMap: concrete.bump, bumpScale: 1.2, roughness: 0.95,
      vertexColors: true, envMapIntensity: 0.15,
    }), 0, TABLE_TOP + WH / 2 - 0.6, WALL_Z);
    wall.castShadow = false;
    room.add(wall);

    // Свет «как в студии»: мягкое тёплое пятно на стене и столе
    const spot = new THREE.SpotLight(0xfff2e6, 260, 0, 0.62, 0.95, 1.6);
    spot.position.set(0, 18, 9);
    spot.target.position.set(0, 1.5, WALL_Z);
    room.add(spot, spot.target);
  }

  // Шум для текстур: плавный «случайный» рисунок, который повторяется без швов
  function makeNoise(seed) {
    let st = seed;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    const perm = new Uint16Array(8192);
    const vals = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) { perm[i] = i; vals[i] = rnd(); }
    for (let i = 4095; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 4096; i++) perm[i + 4096] = perm[i];
    const wrap = (n, per) => ((n % per) + per) % per;
    const hash = (x, y, px, py) => vals[perm[(wrap(x, px) & 4095) + perm[wrap(y, py) & 4095]] & 4095];
    // px, py — период повтора (в клетках шума): текстура ложится плиткой без шва
    function noise(x, y, px = 4096, py = 4096) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a0 = hash(xi, yi, px, py), b0 = hash(xi + 1, yi, px, py);
      const a1 = hash(xi, yi + 1, px, py), b1 = hash(xi + 1, yi + 1, px, py);
      const top = a0 + (b0 - a0) * u, bottom = a1 + (b1 - a1) * u;
      return top + (bottom - top) * v;
    }
    // несколько слоёв шума разного масштаба — получается «природный» рисунок
    function fbm(x, y, oct, px, py) {
      let sum = 0, amp = 0.5, f = 1;
      for (let o = 0; o < oct; o++) { sum += amp * noise(x * f, y * f, px * f, py * f); amp *= 0.5; f *= 2; }
      return sum;
    }
    return { noise, fbm, rnd };
  }

  function canvasTex(c, srgb) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  // Доски столешницы. Рисунок дерева — из textures.js (8 досок в одной картинке,
  // сделана скриптом tools/make_table_textures.py). Каждая 3D-доска берёт свою полосу.
  function buildPlanks(TW, TD, top, wallZ) {
    const group = new THREE.Group();
    const PL_W = 8, PL_L = 64, GAP = 0.05, THICK = 1.2;   // доска ≈ 15 см × 1.2 м
    const N = makeNoise(5);
    const base = {};
    if (woodImages) {
      for (const [k, img] of Object.entries(woodImages)) {
        const t = new THREE.Texture(img);
        if (k === "color") t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        t.needsUpdate = true;
        base[k] = t;
      }
    }
    // копия текстуры, которая показывает только нужный кусок картинки
    const part = (tex, u0, uLen, band, vLen = 1 / 8) => {
      if (!tex) return null;
      const t = tex.clone();
      t.repeat.set(uLen, vLen);
      t.offset.set(u0, band / 8 + (1 / 8 - vLen) / 2);
      t.needsUpdate = true;
      return t;
    };
    const rows = Math.ceil(TD / PL_W);
    for (let r = 0; r < rows; r++) {
      const z = wallZ + PL_W / 2 + r * PL_W;
      let x = -TW / 2 - N.rnd() * PL_L;                     // стыки вразбежку
      while (x < TW / 2) {
        const len = PL_L * (0.6 + N.rnd() * 0.4);
        const band = Math.floor(N.rnd() * 8);
        const u0 = N.rnd() * (1 - len / PL_L);
        const uLen = len / PL_L;
        const shade = 0.88 + N.rnd() * 0.2;                // доски чуть отличаются по тону
        const mat = new THREE.MeshPhysicalMaterial({
          map: part(base.color, u0, uLen, band),
          roughnessMap: part(base.rough, u0, uLen, band),
          normalMap: part(base.normal, u0, uLen, band),
          normalScale: new THREE.Vector2(0.3, 0.3),
          color: woodImages ? new THREE.Color(shade, shade, shade) : new THREE.Color(0x4a2e1c),
          roughness: 1, clearcoat: 0.04, clearcoatRoughness: 0.7, envMapIntensity: 0.2,
        });
        // боковые грани — тонкий срез той же доски (видны на переднем крае стола)
        const edge = new THREE.MeshStandardMaterial({
          map: part(base.color, u0, uLen, band, 1 / 64), color: new THREE.Color(shade * 0.8, shade * 0.8, shade * 0.8),
          roughness: 0.8,
        });
        const geo = new RoundedBoxGeometry(len - GAP, THICK, PL_W - GAP, 2, 0.06);
        const plank = new THREE.Mesh(geo, [edge, edge, mat, edge, edge, edge]);   // +x, −x, верх, низ, перед, зад
        // чуть разная высота и лёгкий перекос — как у настоящего стола
        plank.position.set(x + len / 2, top - THICK / 2 - N.rnd() * 0.025, z);
        plank.rotation.set((N.rnd() - 0.5) * 0.003, 0, (N.rnd() - 0.5) * 0.002);
        plank.receiveShadow = true;
        group.add(plank);
        x += len;
      }
    }
    return group;
  }

  // Бетон: крупные пятна, мелкая зернистость, потёки и поры
  function concreteTextures() {
    const S = 1024;
    const N = makeNoise(21);
    const mk = () => { const c = document.createElement("canvas"); c.width = c.height = S; return c; };
    const cc = mk(), cb = mk();
    const dc = cc.getContext("2d").createImageData(S, S);
    const db = cb.getContext("2d").createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const big = N.fbm(u * 4, v * 4, 5, 4, 4);
        const grain = N.noise(u * 300, v * 300, 300, 300);
        const streak = N.fbm(u * 24, v * 2, 3, 24, 2);
        const t = 0.5 + 0.38 * (big - 0.5) + 0.12 * (grain - 0.5) + 0.12 * (streak - 0.5);
        const i = (y * S + x) * 4;
        const val = 92 + 70 * t;
        dc.data[i] = val; dc.data[i + 1] = val + 1; dc.data[i + 2] = val + 3; dc.data[i + 3] = 255;
        db.data[i] = db.data[i + 1] = db.data[i + 2] = 255 * (0.5 + 0.5 * (grain - 0.5) + 0.4 * (big - 0.5));
        db.data[i + 3] = 255;
      }
    }
    const cx = cc.getContext("2d"), bx = cb.getContext("2d");
    cx.putImageData(dc, 0, 0); bx.putImageData(db, 0, 0);
    // поры — мелкие тёмные точки
    for (let n = 0; n < 2600; n++) {
      const x = N.rnd() * S, y = N.rnd() * S, r = 0.6 + N.rnd() * 1.8;
      cx.fillStyle = `rgba(40,40,42,${0.25 + N.rnd() * 0.4})`;
      cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
      bx.fillStyle = "rgba(0,0,0,0.7)";
      bx.beginPath(); bx.arc(x, y, r, 0, Math.PI * 2); bx.fill();
    }
    return { color: canvasTex(cc, true), bump: canvasTex(cb) };
  }

  // Рисунок крышки берём из встроенного в страницу SVG
  function loadLidTexture(mat) {
    const svg = document.getElementById("box-lid-art");
    if (!svg) return;
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 2000; c.height = 1132;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    };
    img.src = url;
  }

  // Листок инструкции: белая бумага, заголовок и простые схемы (как на фото распаковки)
  function guideTexture() {
    const c = document.createElement("canvas");
    c.width = 680; c.height = 480;
    const x = c.getContext("2d");
    x.fillStyle = "#f1f0ec"; x.fillRect(0, 0, 680, 480);
    x.fillStyle = "#2a2b2d";
    x.font = "600 30px Inter, Arial, sans-serif";
    x.fillText("Multi-mode Mechanical Keyboard", 36, 62);
    x.font = "400 22px Inter, Arial, sans-serif";
    x.fillText("Overview · Quick guide", 36, 98);
    x.strokeStyle = "#7c7e82"; x.lineWidth = 2;
    x.strokeRect(36, 130, 290, 300);
    x.strokeRect(356, 130, 290, 300);
    x.beginPath(); x.moveTo(36, 430); x.lineTo(326, 130); x.stroke();
    // переключатель режимов на схеме
    x.strokeRect(150, 200, 40, 90); x.fillStyle = "#7c7e82"; x.fillRect(156, 206, 28, 38);
    x.strokeRect(220, 200, 40, 90); x.fillRect(226, 246, 28, 38);
    x.strokeRect(420, 300, 160, 70); x.strokeRect(470, 200, 60, 40);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ========================================================
     ПОДПИСИ И ЛИНИИ (обычный HTML поверх 3D)
     Тексты берём из подписей CSS-версии, чтобы не дублировать.
     ======================================================== */
  const overlay = document.createElement("div");
  overlay.className = "overlay3d";
  overlay.setAttribute("aria-hidden", "true");   // тексты уже есть в странице для экранных дикторов
  const linesSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  linesSvg.classList.add("lines3d");
  overlay.appendChild(linesSvg);
  stage.appendChild(overlay);

  const labels = [...document.querySelectorAll(".layer .label")].map((src) => {
    const el = document.createElement("div");
    el.className = "label3d";
    el.innerHTML = src.innerHTML;
    overlay.appendChild(el);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", "3.5");
    linesSvg.append(line, dot);
    return { el, line, dot };
  });

  /* ========================================================
     ВРАЩЕНИЕ МЫШКОЙ / ПАЛЬЦЕМ
     По горизонтали — поворот, по вертикали — небольшой наклон.
     Клавиатура и коробка крутятся вместе. Стена стоит дальше, чем достаёт
     угол клавиатуры, поэтому её не задевает. Отпустил — модель плавно возвращается.
     ======================================================== */
  const drag = { on: false, x: 0, y: 0, yaw: 0, pitch: 0, yawT: 0, pitchT: 0, locked: false };
  canvas.addEventListener("pointerdown", (e) => {
    if (drag.locked) return;              // клавиатура уже в коробке — крутить нельзя
    drag.on = true; drag.x = e.clientX; drag.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("is-dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag.on) return;
    drag.yawT += (e.clientX - drag.x) * 0.008;
    drag.pitchT = clamp(drag.pitchT + (e.clientY - drag.y) * 0.004, -0.35, 0.35);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const stopDrag = () => { drag.on = false; canvas.classList.remove("is-dragging"); };
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);

  /* ========================================================
     РАЗМЕРЫ ЭКРАНА И ПОЛОЖЕНИЯ КАМЕРЫ
     ======================================================== */
  let W = 0, H = 0, mobile = false;
  function resize() {
    W = stage.clientWidth; H = stage.clientHeight;
    mobile = W <= 760;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.75 : 2));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = !mobile;   // на телефоне без теней — быстрее
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  // На каком расстоянии поставить камеру, чтобы ширина worldW поместилась в px пикселей
  function distForWidth(worldW, px) {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return (worldW * (W / px)) / 2 / (tan * camera.aspect);
  }
  function distForHeight(worldH, px) {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return (worldH * (H / px)) / 2 / tan;
  }

  // Три «позы» камеры: elev — наклон, azim — поворот, dist — расстояние, ty — высота цели,
  // sx/sy — сдвиг картинки на экране (доля ширины/высоты)
  function poses() {
    const plate = mobile ? W * 0.88 : Math.min(W * 0.5, 640, H * 0.95);
    // клавиатура стоит на столе: смотрим чуть сверху, модель — ниже центра (над ней заголовок)
    const hero = { elev: 0.42, azim: 0, ty: 0.8, sx: 0, sy: mobile ? -0.12 : -0.14 };
    hero.dist = distForWidth(CASE_W, plate * (mobile ? 1 : 0.9));

    const explode = { elev: 0.5, azim: -0.3, ty: 0.9 + SKY, sx: mobile ? 0 : 0.12, sy: mobile ? 0.07 : 0 };
    const stackH = 8 * SPREAD * Math.cos(explode.elev) + CASE_D * Math.sin(explode.elev) + 2.5;
    explode.dist = Math.max(distForWidth(19, plate), distForHeight(stackH, H - (mobile ? 15 : 6) * 16));

    // коробка на столе, клавиатура зависает над ней — в кадре должно быть место по высоте
    const boxPose = { elev: 0.62, azim: -0.3, ty: 3.6, sx: mobile ? 0 : 0.12, sy: mobile ? 0.02 : -0.08 };
    boxPose.dist = Math.max(distForWidth(15.5, plate), distForHeight(14, H - (mobile ? 20 : 6) * 16));
    return { hero, explode, box: boxPose };
  }

  /* ========================================================
     ГЛАВНЫЙ ЦИКЛ: каждый кадр
     ======================================================== */
  let shown = 0;          // «показанный» прогресс — плавно догоняет настоящий
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(section);

  const v = new THREE.Vector3();
  const clock = new THREE.Clock();

  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;

    // 1) Насколько прокручена секция: 0 — начало, 1 — конец
    const r = section.getBoundingClientRect();
    const target = clamp(-r.top / (section.offsetHeight - H), 0, 1);
    // плавно догоняем; формула одинаково плавная при любой частоте кадров
    const dt = Math.min(clock.getDelta(), 0.1);
    shown += (target - shown) * (1 - Math.pow(1 - SMOOTH, dt * 60));
    const p = shown;
    const time = clock.elapsedTime;

    // 2) Камера: из вида сверху → в 3/4 → к коробке
    const P = poses();
    const a = ease(range01(p, ...T.up));     // от стола — в небо
    const b = ease(range01(p, ...T.back));   // из неба — к коробке на столе
    const pose = {};
    for (const k of ["elev", "azim", "dist", "ty", "sx", "sy"]) {
      pose[k] = lerp(lerp(P.hero[k], P.explode[k], a), P.box[k], b);
    }
    // Как только клавиатура начинает опускаться в коробку — вращение выключаем,
    // а модель плавно возвращается в обычное положение
    drag.locked = p >= T.kbDown[0];
    canvas.classList.toggle("no-drag", drag.locked);
    if (drag.locked) { stopDrag(); drag.yawT = 0; drag.pitchT = 0; }
    drag.yaw += ((drag.on ? drag.yawT : (drag.yawT *= 0.96)) - drag.yaw) * 0.15;
    drag.pitch += ((drag.on ? drag.pitchT : (drag.pitchT *= 0.96)) - drag.pitch) * 0.15;
    const elev = clamp(pose.elev + drag.pitch, 0.15, 1.45);
    camera.position.set(
      pose.dist * Math.cos(elev) * Math.sin(pose.azim),
      pose.ty + pose.dist * Math.sin(elev),
      pose.dist * Math.cos(elev) * Math.cos(pose.azim)
    );
    camera.lookAt(0, pose.ty, 0);
    camera.setViewOffset(W, H, pose.sx * W, pose.sy * H, W, H);
    // лёгкое «дыхание» модели в начале + поворот мышкой
    // поворот мышкой + лёгкое «дыхание» модели в начале
    root.rotation.y = drag.yaw + Math.sin(time * 0.6) * 0.04 * (1 - a) * (1 - b);

    // 3) Разлёт слоёв
    const opens = layers.map((L, i) => {
      const s = T.openStart + i * (mobile ? 0.035 : T.openStagger);
      const c = T.closeStart + (8 - i) * T.closeStagger;
      const open = ease(range01(p, s, s + (mobile ? 0.08 : T.openLen)));
      const close = ease(range01(p, c, c + T.closeLen));
      L.group.position.y = (4 - i) * (mobile ? SPREAD * 0.85 : SPREAD) * (open - close);
      return { open, close, e: open - close };
    });

    // 4) Клавиатура: взлетает со стола вверх → (разборка/сборка в темноте) →
    //    спускается, уменьшается и зависает над коробкой → опускается в выемку.
    //    Камера летит с той же скоростью (поза «explode» на высоте SKY), поэтому
    //    клавиатура всё время в кадре, а стол со стеной уходят вниз.
    const down = ease(range01(p, ...T.kbDown));
    keyboard.position.y = lerp(lerp(SKY * a, HOVER, b), 0.12, down);
    keyboard.position.z = POCKET_Z * b;
    keyboard.scale.setScalar(lerp(1, KB_IN_BOX, b));
    // солнце (и его тени) следует за клавиатурой
    sun.position.set(-8, 16 + keyboard.position.y, 10);
    sun.target.position.set(0, keyboard.position.y, 0);

    // 5) Коробка: в начале её на столе нет — ставим, пока камера «в небе»
    box.visible = p > 0.3;
    hinge.rotation.x = -2.3 * (1 - ease(range01(p, ...T.lidClose)));    // стоит открытой, в конце крышка закрывается

    renderer.render(scene, camera);

    // 6) Подписи, заголовок, список комплекта
    updateOverlay(p, opens);
  }

  // Перевод точки из 3D в пиксели экрана
  function toScreen(obj, local) {
    v.copy(local);
    obj.localToWorld(v);
    v.project(camera);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
  }

  function updateOverlay(p, opens) {
    // Заголовок и подсказка гаснут в начале прокрутки
    const heroOut = range01(p, 0, 0.05);
    heroTitle.style.opacity = 1 - heroOut;
    heroTitle.style.translate = `0 ${-3 * heroOut}rem`;
    hint.style.opacity = 1 - heroOut;

    // Подписи к слоям
    keyboard.updateMatrixWorld();
    const pts = layers.map((L) => toScreen(L.group, L.anchor));
    const colX = Math.min(Math.max(...pts.map((q) => q.x)) + 56, W - 24 * 16 - 16);
    let prevY = -Infinity;
    labels.forEach((L, i) => {
      let op, x, y;
      if (mobile) {
        // на телефоне — по одной подписи внизу экрана
        const s = 0.13 + i * 0.035;
        const t = range01(p, s, s + 0.035);
        op = t <= 0 || t >= 1 ? 0 : Math.min(1, t / 0.15, (1 - t) / 0.15);
        x = W / 2; y = H - 7.5 * 16;
        L.line.style.opacity = L.dot.style.opacity = 0;
      } else {
        op = clamp(opens[i].e * 3 - 2, 0, 1);
        x = colX;
        y = Math.max(pts[i].y, prevY + 58);   // не даём подписям налезать друг на друга
        prevY = y;
        L.line.setAttribute("x1", pts[i].x); L.line.setAttribute("y1", pts[i].y);
        L.line.setAttribute("x2", x - 10);   L.line.setAttribute("y2", y);
        L.dot.setAttribute("cx", pts[i].x);  L.dot.setAttribute("cy", pts[i].y);
        L.line.style.opacity = L.dot.style.opacity = op;
      }
      L.el.style.opacity = op;
      L.el.style.transform = `translate(${x}px, ${y}px) translate(${mobile ? "-50%" : "0"}, -50%) translateX(${(1 - op) * 1.5}rem)`;
      L.el.style.visibility = op > 0.01 ? "visible" : "hidden";
    });

    // Список комплекта — рядом с коробкой (на телефоне под ней)
    box.updateMatrixWorld();
    // углы коробки на экране: список ставим правее самого правого (на телефоне — ниже самого нижнего)
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => toScreen(box, new THREE.Vector3(sx * BW / 2, BH / 2, sz * BD / 2))));
    const anchor = mobile
      ? { y: Math.max(...corners.map((c) => c.y)) }
      : { x: Math.max(...corners.map((c) => c.x)), y: corners.reduce((sum, c) => sum + c.y, 0) / 4 };
    kit.style.transform = mobile
      ? `translate(${W / 2}px, ${anchor.y + 28}px) translateX(-50%)`
      : `translate(${anchor.x + 48}px, ${anchor.y}px) translateY(-50%)`;
    kitTitle.style.opacity = range01(p, 0.9, 0.93);
    kitItems.forEach((li, k) => {
      const t = ease(range01(p, 0.91 + k * 0.012, 0.94 + k * 0.012));
      li.style.opacity = t;
      li.style.translate = `${(1 - t) * 1.5}rem 0`;
    });
  }

  /* ========================================================
     ЗАПУСК
     ======================================================== */
  resize();
  frame();
  // Включаем 3D-режим в CSS (прячем плоские рисунки, показываем холст)
  document.documentElement.classList.add("has-3d");
  document.documentElement.classList.remove("loading-3d");

  /* ---------- маленькие математические помощники ---------- */
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function range01(x, a, b) { return clamp((x - a) / (b - a), 0, 1); }   // где x между a и b (0…1)
  function ease(t) { return t * t * (3 - 2 * t); }                         // плавный старт и финиш
}
