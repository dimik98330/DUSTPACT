import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type InteractionId =
  | "water"
  | "salvage"
  | "wagon"
  | "aisha"
  | "timur"
  | "saya"
  | "nura"
  | "alan"
  | "gate";
export type CharacterModel = "Rogue_Hooded" | "Knight" | "Mage" | "Barbarian";
export interface WorldCast {
  hero: CharacterModel;
  companions: Array<{
    id: "aisha" | "timur" | "saya" | "nura" | "alan";
    model: CharacterModel;
  }>;
}
export interface WorldResolution {
  guard: number;
  threat: number;
  hullBefore: number;
  hullAfter: number;
  /** Already resolved actions, with the controlled hero first. */
  actions: number[];
}
export interface WorldCallbacks {
  ariaLabel?:string;
  onReady(): void;
  onError(message: string): void;
  onNearby(id: InteractionId | null): void;
  onInteract(id: InteractionId): void;
  onProgress(label: string): void;
  onGuide?(distance: number, bearing: number): void;
}
export interface WorldController {
  setAccessibleLabel(label:string):void;
  dispose(): void;
  setPaused(value: boolean): void;
  setJoystick(x: number, z: number): void;
  setStage(stage: number): void;
  interact(): void;
  animateInteraction(): void;
  resetCamera(): void;
  setObjective(id: InteractionId): void;
  /** Optional V2 consequence presentation; does not determine game outcomes. */
  setEncounterOutcome?(objective: boolean | null): void;
  playResolution(summary: WorldResolution): Promise<void>;
}
interface Actor {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
  offset: THREE.Vector3;
  baseModelY: number;
  feet: THREE.SkinnedMesh[];
}
const TAU = Math.PI * 2;
const basePalette = {
  sand: 0xc5a77b,
  road: 0xd7bc8d,
  stone: 0xb38c65,
  darkStone: 0x8b6e59,
  wood: 0x624634,
  linen: 0xe0c99c,
  cloth: 0x934e42,
  water: 0x64b9bc,
};
export function terrainHeight(x: number, z: number) {
  const center = Math.sin(z * 0.045) * 2.8;
  const d = Math.abs(x - center);
  const dunes =
    Math.sin(x * 0.14 + z * 0.055) * 0.6 +
    Math.sin(z * 0.16 - x * 0.1) * 0.26 +
    Math.cos(x * 0.33) * 0.15;
  return dunes * THREE.MathUtils.smoothstep(d, 4, 18);
}
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>(),
    skeletons = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geometries.add(m.geometry);
    if (m.material)
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((a) =>
        materials.add(a),
      );
    if ((o as THREE.SkinnedMesh).isSkinnedMesh)
      skeletons.add((o as THREE.SkinnedMesh).skeleton);
  });
  skeletons.forEach((s) => s.dispose());
  materials.forEach((m) => {
    Object.values(m).forEach((v) => {
      if (v instanceof THREE.Texture) textures.add(v);
    });
    m.dispose();
  });
  textures.forEach((t) => {
    t.dispose();
    const image = t.image as { close?: () => void } | undefined;
    if (typeof image?.close === "function") image.close();
  });
  geometries.forEach((g) => g.dispose());
}
export async function createWorld(
  host: HTMLDivElement,
  cb: WorldCallbacks,
  initialStage = 0,
  cast: WorldCast = {
    hero: "Rogue_Hooded",
    companions: [
      { id: "aisha", model: "Knight" },
      { id: "timur", model: "Mage" },
      { id: "saya", model: "Barbarian" },
    ],
  },
  presentation: { encounters?: boolean } = {},
): Promise<WorldController> {
  let stage = Math.max(0, Math.min(5, Math.trunc(initialStage)));
  const stageNames = presentation.encounters ? ["Разрушенный колодец", "Сломанный мост", "Заброшенная кладовая", "Засада", "Пыльная буря", "Город за туманом"] : [
    "Тихая долина",
    "Солёное русло",
    "Каменные ворота",
    "Поющий песок",
    "Последний фонарь",
    "Город за туманом",
  ];
  const profiles = [
    {
      sand: 0xc5a77b,
      shade: 0xad956e,
      road: 0xd7bc8d,
      stone: 0xb38c65,
      darkStone: 0x8b6e59,
      sky: 0x91b9c5,
      haze: 0xdcd2b5,
      sun: 0xffdfab,
      grass: 0x87845b,
      sunPower: 3.2,
      skyPower: 2.1,
      fogNear: 60,
      fogFar: 175,
    },
    {
      sand: 0xd3d4bd,
      shade: 0xa8bbb4,
      road: 0xe6dfc6,
      stone: 0xa9aaa2,
      darkStone: 0x879c99,
      sky: 0x9cc2c7,
      haze: 0xe9e4ce,
      sun: 0xffefcd,
      grass: 0x9da58c,
      sunPower: 2.8,
      skyPower: 2.2,
      fogNear: 70,
      fogFar: 190,
    },
    {
      sand: 0x9d957e,
      shade: 0x7c887f,
      road: 0xb6b59b,
      stone: 0x7c8988,
      darkStone: 0x576f76,
      sky: 0x7c9fac,
      haze: 0xbcc7bf,
      sun: 0xffd4a3,
      grass: 0x728c78,
      sunPower: 2.7,
      skyPower: 1.9,
      fogNear: 48,
      fogFar: 140,
    },
    {
      sand: 0xc48955,
      shade: 0xa16c48,
      road: 0xd9a96d,
      stone: 0xb77551,
      darkStone: 0x975244,
      sky: 0x9c9696,
      haze: 0xe4b17b,
      sun: 0xffc78c,
      grass: 0xa88a5c,
      sunPower: 2.4,
      skyPower: 1.9,
      fogNear: 35,
      fogFar: 120,
    },
    {
      sand: 0x637580,
      shade: 0x435766,
      road: 0x91a0a4,
      stone: 0x4e6577,
      darkStone: 0x344759,
      sky: 0x152b4b,
      haze: 0x607f94,
      sun: 0xa8cffa,
      grass: 0x506d78,
      sunPower: 0.8,
      skyPower: 1.35,
      fogNear: 45,
      fogFar: 130,
    },
    {
      sand: 0xb7baa4,
      shade: 0x8faaa6,
      road: 0xd5cfaf,
      stone: 0xb8b394,
      darkStone: 0x7e9b95,
      sky: 0xb4ceca,
      haze: 0xdfe2cc,
      sun: 0xffe5b6,
      grass: 0x8bada1,
      sunPower: 2.3,
      skyPower: 2.2,
      fogNear: 32,
      fogFar: 120,
    },
  ];
  const palette = { ...basePalette };
  function heightAt(x: number, z: number) {
    const base = terrainHeight(x, z);
    if (stage === 2) return base + THREE.MathUtils.smoothstep(-z, 0, 52) * 6;
    if (stage === 1) return base * 0.28;
    if (stage === 3) return base * 1.7;
    return base;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb8ccc9);
  scene.fog = new THREE.Fog(0xc4c9ba, 55, 175);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    "aria-label",
    cb.ariaLabel??"Трёхмерная долина. WASD — ходить, перетаскивание — камера, E — действие.",
  );
  host.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(
    48,
    host.clientWidth / host.clientHeight,
    0.1,
    400,
  );
  const hemi = new THREE.HemisphereLight(0xc0e1f5, 0x9e7348, 2.1);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffdfb1, 0.25));
  const sun = new THREE.DirectionalLight(0xffdfab, 3.2);
  sun.position.set(-35, 65, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -37;
  sun.shadow.camera.right = 37;
  sun.shadow.camera.top = 37;
  sun.shadow.camera.bottom = -37;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(240, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x8aaeb9) },
        bottom: { value: new THREE.Color(0xf0d3a1) },
      },
      vertexShader:
        "varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "uniform vec3 top;uniform vec3 bottom;varying vec3 vPos;void main(){float h=clamp(normalize(vPos).y*.9+.1,0.,1.);gl_FragColor=vec4(mix(bottom,top,h),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
    }),
  );
  scene.add(sky);
  const world = new THREE.Group();
  scene.add(world);
  const collisions: { x: number; z: number; r: number }[] = [];
  const cameraBlockers: THREE.Object3D[] = [];
  const cameraRay = new THREE.Raycaster();
  const flags: { mesh: THREE.Mesh; base: Float32Array }[] = [];
  const glowObjects: THREE.Object3D[] = [];
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  function mat(color: number, roughness = 0.9) {
    const key = `${color}:${roughness}`;
    if (!mats.has(key))
      mats.set(
        key,
        new THREE.MeshStandardMaterial({ color, roughness, flatShading: true }),
      );
    return mats.get(key)!;
  }
  function mesh(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    parent: THREE.Object3D = world,
  ) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    if (
      material instanceof THREE.MeshStandardMaterial &&
      material.opacity >= 0.99 &&
      !material.vertexColors &&
      !(geo instanceof THREE.PlaneGeometry)
    )
      cameraBlockers.push(m);
    return m;
  }
  function box(
    w: number,
    h: number,
    d: number,
    color: number,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = world,
  ) {
    return mesh(new THREE.BoxGeometry(w, h, d), mat(color), x, y, z, parent);
  }
  function rock(
    x: number,
    z: number,
    s: number,
    seed: number,
    parent: THREE.Object3D = world,
  ) {
    const r = seeded(seed),
      m = mesh(
        new THREE.DodecahedronGeometry(1, 0),
        mat(seed % 2 ? palette.stone : palette.darkStone),
        x,
        heightAt(x, z) + s * 0.28,
        z,
        parent,
      );
    m.scale.set(
      s * (0.7 + r() * 0.6),
      s * (0.4 + r() * 0.7),
      s * (0.7 + r() * 0.4),
    );
    m.rotation.set(r() * 0.3, r() * TAU, r() * 0.25);
    return m;
  }
  function batchStatic(
    root: THREE.Object3D,
    dynamic = new Set<THREE.Object3D>(),
  ) {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    root.traverse((object) => {
      const item = object as THREE.Mesh;
      if (
        !item.isMesh ||
        (item as THREE.InstancedMesh).isInstancedMesh ||
        (item as THREE.SkinnedMesh).isSkinnedMesh ||
        dynamic.has(item)
      )
        return;
      const material = item.material;
      if (
        !(material instanceof THREE.MeshStandardMaterial) ||
        material.transparent ||
        material.vertexColors ||
        item.matrixWorld.determinant() < 0
      )
        return;
      const list = groups.get(material) ?? [];
      list.push(item);
      groups.set(material, list);
    });
    let count = 0;
    for (const [material, source] of groups) {
      if (source.length < 2) continue;
      const geometries = source.map((item) => {
        let geometry = item.geometry.clone();
        if (geometry.index) {
          const indexed = geometry;
          geometry = indexed.toNonIndexed();
          indexed.dispose();
        }
        for (const attribute of Object.keys(geometry.attributes)) {
          if (!["position", "normal", "uv"].includes(attribute))
            geometry.deleteAttribute(attribute);
        }
        if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
        if (!geometry.getAttribute("uv"))
          geometry.setAttribute(
            "uv",
            new THREE.Float32BufferAttribute(
              new Float32Array(geometry.getAttribute("position").count * 2),
              2,
            ),
          );
        return geometry.applyMatrix4(
          new THREE.Matrix4().multiplyMatrices(inverse, item.matrixWorld),
        );
      });
      const combined = mergeGeometries(geometries, false);
      geometries.forEach((geometry) => geometry.dispose());
      if (!combined) continue;
      combined.computeBoundingSphere();
      const batch = new THREE.Mesh(combined, material);
      batch.name = "Static batch " + count;
      batch.castShadow = source.some((item) => item.castShadow);
      batch.receiveShadow = source.some((item) => item.receiveShadow);
      root.add(batch);
      // The detached source meshes retain their measured world matrices for
      // short camera rays. Batching never changes collision circles or hit shapes.
      source.forEach((item) => item.removeFromParent());
      count++;
    }
    return count;
  }
  const objectives = new Map<InteractionId, THREE.Vector3>();
  let flame: THREE.Mesh, well: THREE.Mesh, fireLight: THREE.PointLight;
  let windDust: THREE.InstancedMesh | null = null;
  let encounterOutcome: boolean | null = null;
  let encounterMarker: THREE.Mesh | null = null;
  function buildLevel() {
    disposeTree(world);
    world.clear();
    mats.clear();
    collisions.length = 0;
    cameraBlockers.length = 0;
    flags.length = 0;
    glowObjects.length = 0;
    objectives.clear();
    windDust = null;
    encounterMarker = null;
    encounterOutcome = null;
    const profile = profiles[stage];
    Object.assign(palette, profile);
    scene.background = new THREE.Color(profile.haze);
    scene.fog = new THREE.Fog(profile.haze, profile.fogNear, profile.fogFar);
    sun.color.setHex(profile.sun);
    sun.intensity = profile.sunPower;
    hemi.intensity = profile.skyPower;
    hemi.color.setHex(stage === 4 ? 0x8db7db : 0xc0e1f5);
    hemi.groundColor.setHex(profile.shade);
    sky.material.uniforms.top.value.setHex(profile.sky);
    sky.material.uniforms.bottom.value.setHex(profile.haze);
    renderer.domElement.dataset.stage = String(stage);
    renderer.domElement.dataset.level = stageNames[stage];
    const groundGeo = new THREE.PlaneGeometry(260, 300, 130, 150);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const sandA = new THREE.Color(profile.sand),
      sandB = new THREE.Color(profile.shade);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
      const c = sandA
        .clone()
        .lerp(sandB, (Math.sin(x * 0.21 + z * 0.33) + 1) * 0.12);
      c.toArray(colors, i * 3);
    }
    groundGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
    const ground = mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      0,
      0,
      -20,
    );
    ground.position.z = 0;
    ground.castShadow = false;
    const roadVerts: number[] = [],
      roadIndices: number[] = [];
    for (let i = 0; i <= 100; i++) {
      const z = 48 - i * 1.32,
        c = Math.sin(z * 0.045) * 2.8;
      roadVerts.push(
        c - 3.2,
        heightAt(c - 3.2, z) + 0.025,
        z,
        c + 3.2,
        heightAt(c + 3.2, z) + 0.025,
        z,
      );
      if (i < 100) {
        let n = i * 2;
        roadIndices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      }
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(roadVerts, 3),
    );
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();
    const road = mesh(roadGeo, mat(palette.road));
    road.receiveShadow = true;
    road.castShadow = false;
    const random = seeded(747 + stage * 997);
    for (let side of [-1, 1])
      for (let i = 0; i < (stage === 1 || stage === 3 ? 8 : 16); i++) {
        const z = 50 - i * 9,
          x =
            side * ((stage === 2 ? 20 : stage === 5 ? 42 : 30) + random() * 16);
        const h =
            (stage === 2 ? 17 : stage === 1 ? 3 : 8) +
            random() * (stage === 3 ? 8 : 19),
          r = 5 + random() * 6;
        const m = mesh(
          new THREE.CylinderGeometry(r * 0.65, r, h, 7, 3),
          mat(i % 3 === 0 ? palette.darkStone : palette.stone),
          x,
          heightAt(x, z) + h * 0.42,
          z,
        );
        m.rotation.y = random() * TAU;
        m.rotation.z = side * 0.05;
        collisions.push({ x, z, r: r * 0.93 });
        collisions.push({ x: x - side * 4, z: z + 2, r: r * 0.55 });
        rock(x - side * 4, z + 2, r * 0.8, i + 4);
      }
    for (let i = 0; i < 75; i++) {
      const x = (random() - 0.5) * 100,
        z = random() * 165 - 90;
      if (Math.abs(x - Math.sin(z * 0.045) * 2.8) < 6) continue;
      if (
        Math.hypot(x - (stage % 2 === 0 ? -12 : 13), z + 4 + (stage % 3) * 6) <
        4
      )
        continue;
      if (
        Math.hypot(x - (stage % 2 === 0 ? 11 : -12), z + 15 + (stage % 3) * 4) <
        4
      )
        continue;
      const size = 0.3 + random() * 1.4;
      rock(x, z, size, i + 30);
      if (Math.abs(x) < 26) collisions.push({ x, z, r: size * 0.65 });
    }
    // Sparse grasses in instanced meshes, avoiding thousands of draw calls.
    const grassGeo = new THREE.ConeGeometry(0.12, 0.7, 3);
    grassGeo.translate(0, 0.35, 0);
    const grass = new THREE.InstancedMesh(grassGeo, mat(profile.grass), 260);
    const dummy = new THREE.Object3D();
    let grassCount = 0;
    for (let i = 0; i < 320 && grassCount < 260; i++) {
      const x = (random() - 0.5) * 70,
        z = random() * 125 - 70;
      if (Math.abs(x - Math.sin(z * 0.045) * 2.8) < 4) continue;
      dummy.position.set(x, heightAt(x, z), z);
      dummy.scale.setScalar(0.5 + random() * 0.7);
      dummy.rotation.y = random() * TAU;
      dummy.updateMatrix();
      grass.setMatrixAt(grassCount++, dummy.matrix);
    }
    grass.count = stage === 1 ? Math.min(18, grassCount) : grassCount;
    grass.receiveShadow = true;
    world.add(grass);
    function tent(x: number, z: number, color: number) {
      const g = new THREE.Group();
      g.position.set(x, heightAt(x, z), z);
      world.add(g);
      const verts = new Float32Array([
        -2, 0, -2, 2, 0, -2, 0, 2.8, -2, -2, 0, 2, 2, 0, 2, 0, 2.8, 2,
      ]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      geo.setIndex([0, 2, 3, 3, 2, 5, 2, 1, 5, 5, 1, 4]);
      geo.computeVertexNormals();
      mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 1,
          side: THREE.DoubleSide,
        }),
        0,
        0,
        0,
        g,
      );
      box(0.1, 3.0, 0.1, 0x66503a, 0, 1.5, -2, g);
      box(0.1, 3.0, 0.1, 0x66503a, 0, 1.5, 2, g);
      box(0.1, 0.1, 4.1, 0x66503a, 0, 2.85, 0, g);
      collisions.push({ x, z, r: 2.1 });
      return g;
    }
    tent(-10, 21, stage === 4 ? 0x697f8a : 0xc6ab7e);
    tent(11, 24, stage === 5 ? 0x4d8e89 : 0xb87c58);
    if (stage !== 2) tent(-14, 28, 0x8c9b85);
    function flag(x: number, z: number, color: number) {
      box(0.08, 5, 0.08, 0x655044, x, heightAt(x, z) + 2.5, z);
      const geo = new THREE.PlaneGeometry(1.1, 1.8, 5, 8);
      geo.translate(0.55, -0.9, 0);
      const m = mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color,
          side: THREE.DoubleSide,
          roughness: 1,
        }),
        x,
        heightAt(x, z) + 4.9,
        z,
      );
      flags.push({
        mesh: m,
        base: new Float32Array(geo.attributes.position.array),
      });
    }
    flag(-5, 27, 0x9a563f);
    flag(6, 26, 0xc3a968);
    flag(-6, -45, 0x9a563f);
    flag(6, -45, 0x9a563f);
    // A legible large gateway and a distant destination, all actual 3D meshes.
    const gateZ = -48;
    const gateY = heightAt(0, gateZ);
    for (const x of [-7, 7]) {
      mesh(
        new THREE.CylinderGeometry(1.8, 2.4, 9, 8),
        mat(palette.stone),
        x,
        gateY + 4.5,
        gateZ,
      );
      mesh(
        new THREE.CylinderGeometry(2.15, 1.8, 0.5, 8),
        mat(palette.road),
        x,
        gateY + 9,
        gateZ,
      );
      collisions.push({ x, z: gateZ, r: 2.4 });
    }
    const arch = mesh(
      new THREE.TorusGeometry(7, 1.15, 6, 20, Math.PI),
      mat(palette.road),
      0,
      gateY + 8.8,
      gateZ,
    );
    arch.castShadow = true;
    for (let i = 0; i < (stage === 5 ? 17 : 7); i++) {
      const x = (i - 6) * 5.7,
        z = (stage === 5 ? -75 : -112) - random() * 22,
        h = 7 + random() * 14;
      mesh(
        new THREE.CylinderGeometry(2.1, 2.5, h, 8),
        mat(i % 2 ? palette.road : palette.stone),
        x,
        h / 2,
        z,
      );
      mesh(
        new THREE.SphereGeometry(2.25, 10, 6, 0, TAU, 0, Math.PI / 2),
        mat(0x80a5a0),
        x,
        h,
        z,
      );
    }
    // Each leg has its own silhouette and traversable surface. Decorative masses
    // stay outside the six-metre walking corridor; navigation never depends on art.
    const landmarks: string[] = [];
    function clearOfActivities(x: number, z: number, radius: number) {
      const waterX = stage % 2 === 0 ? -12 : 13,
        waterZ = -4 - (stage % 3) * 6;
      const salvageX = stage % 2 === 0 ? 11 : -12,
        salvageZ = -15 - (stage % 3) * 4;
      return (
        Math.hypot(x - waterX, z - waterZ) > radius + 3.8 &&
        Math.hypot(x - salvageX, z - salvageZ) > radius + 3.8
      );
    }
    function lamp(x: number, z: number, height = 3.4) {
      const y = heightAt(x, z);
      box(0.13, height, 0.13, palette.wood, x, y + height / 2, z);
      box(0.8, 0.13, 0.18, palette.wood, x + 0.3, y + height, z);
      const glow = mesh(
        new THREE.CylinderGeometry(0.21, 0.26, 0.55, 6),
        new THREE.MeshStandardMaterial({
          color: 0xffd88b,
          emissive: 0xffb74d,
          emissiveIntensity: stage === 4 ? 2.2 : 0.7,
        }),
        x + 0.58,
        y + height - 0.4,
        z,
      );
      box(
        0.55,
        0.08,
        0.55,
        0x5c655d,
        glow.position.x,
        glow.position.y + 0.3,
        z,
      );
      collisions.push({ x, z, r: 0.25 });
      if (stage === 4 && Math.abs(z % 22) < 0.1) {
        const light = new THREE.PointLight(0xffbf67, 7, 10, 2);
        light.position.copy(glow.position);
        world.add(light);
      }
    }
    if (stage === 0) {
      landmarks.push("Оазис с акациями", "Открытая долина");
      for (const [x, z, s] of [
        [-17, -4, 1],
        [-18, 4, 1.2],
        [-10, -10, 0.85],
        [16, 5, 1.1],
        [18, -30, 0.9],
        [-17, -34, 1.15],
      ]) {
        const y = heightAt(x, z);
        const trunk = mesh(
          new THREE.CylinderGeometry(0.14 * s, 0.3 * s, 3.5 * s, 6),
          mat(0x6b6b45),
          x,
          y + 1.75 * s,
          z,
        );
        trunk.rotation.z = 0.1;
        const crown = mesh(
          new THREE.IcosahedronGeometry(1, 1),
          mat(0x728861),
          x,
          y + 3.6 * s,
          z,
        );
        crown.scale.set(2.5 * s, 0.7 * s, 1.8 * s);
        collisions.push({ x, z, r: 0.4 * s });
      }
    } else if (stage === 1) {
      landmarks.push("Белые соляные террасы", "Кристаллы высохшего русла");
      for (const side of [-1, 1])
        for (let i = 0; i < 12; i++) {
          const z = 24 - i * 7,
            x = side * (28 + Math.sin(i * 0.8) * 2);
          const terrace = mesh(
            new THREE.CylinderGeometry(5.2, 5.9, 0.45, 6),
            mat(i % 2 ? 0xe4e3cc : 0xc7d1c6),
            x,
            heightAt(x, z) + 0.2,
            z,
          );
          terrace.scale.x = 1.3;
          collisions.push({ x, z, r: 7.6 });
        }
      const crystals = new THREE.InstancedMesh(
        new THREE.ConeGeometry(0.35, 1.6, 5),
        mat(0xd4eee7, 0.5),
        84,
      );
      const cracks = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 0.018, 0.032),
        mat(0x97aaa3),
        160,
      );
      for (let i = 0; i < 160; i++) {
        const x = (random() - 0.5) * 35,
          z = 28 - random() * 92;
        dummy.position.set(x, heightAt(x, z) + 0.024, z);
        dummy.scale.set(0.5 + random() * 1.4, 1, 1);
        dummy.rotation.set(0, random() * TAU, 0);
        dummy.updateMatrix();
        cracks.setMatrixAt(i, dummy.matrix);
        if (i < 84) {
          const cx = (i % 2 ? -1 : 1) * (12 + random() * 13);
          dummy.position.set(cx, heightAt(cx, z) + 0.5, z);
          dummy.scale.setScalar(0.35 + random());
          dummy.rotation.z = (random() - 0.5) * 0.4;
          dummy.updateMatrix();
          crystals.setMatrixAt(i, dummy.matrix);
        }
      }
      world.add(crystals, cracks);
      crystals.castShadow = true;
      // The abandoned boat is a solid low-poly hull beside the path.
      const boat = mesh(
        new THREE.CylinderGeometry(1, 0.5, 1.3, 6),
        mat(0x7c7160),
        -10,
        heightAt(-10, -29) + 0.5,
        -29,
      );
      boat.scale.set(1.5, 1, 3.3);
      boat.rotation.z = 0.22;
      box(0.12, 5, 0.12, 0x796a55, -10, heightAt(-10, -29) + 3, -29);
      collisions.push({ x: -10, z: -29, r: 3.3 });
    } else if (stage === 2) {
      landmarks.push(
        "Подъём к перевалу",
        "Каменные контрфорсы и верёвочные ограждения",
      );
      for (const side of [-1, 1])
        for (let i = 0; i < 8; i++) {
          const z = 8 - i * 7,
            x = side * (13.5 + Math.sin(i) * 0.8);
          const radius = (3.5 + i * 0.18) * 1.3;
          if (clearOfActivities(x, z, radius)) {
            rock(x, z, 3.5 + i * 0.18, 930 + i);
            collisions.push({ x, z, r: radius });
          }
          const rx = side * 5.2;
          box(0.15, 1.4, 0.15, 0x6e6758, rx, heightAt(rx, z) + 0.7, z);
          const rope = mesh(
            new THREE.CylinderGeometry(0.045, 0.045, 7.4, 5),
            mat(0xa79e7f),
            rx,
            heightAt(rx, z - 3.5) + 1.15,
            z - 3.5,
          );
          rope.rotation.x = Math.PI / 2 + 0.09;
        }
      box(18, 2.2, 3.8, palette.darkStone, 0, gateY + 14.7, gateZ - 1);
      for (const side of [-1, 1])
        box(2.5, 9, 4.4, palette.stone, side * 10, gateY + 6, gateZ - 1);
    } else if (stage === 3) {
      landmarks.push("Песчаные гряды", "Каменные арки ветра", "Поющие струны");
      for (const side of [-1, 1])
        for (let i = 0; i < 7; i++) {
          const x = side * (22 + random() * 18),
            z = 22 - i * 13;
          if (!clearOfActivities(x, z, 13)) continue;
          const dune = mesh(
            new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, Math.PI / 2),
            mat(i % 2 ? palette.sand : palette.road),
            x,
            heightAt(x, z) - 0.2,
            z,
          );
          dune.scale.set(13, 3 + random() * 3, 8);
          dune.rotation.y = 0.4;
          collisions.push({ x, z, r: 13 });
        }
      for (const [x, z, turn] of [
        [-18, -10, -0.4],
        [20, -35, 0.2],
        [-21, -54, -0.15],
      ]) {
        const arc = mesh(
          new THREE.TorusGeometry(5, 0.9, 5, 12, Math.PI),
          mat(palette.stone),
          x,
          heightAt(x, z) + 3,
          z,
        );
        arc.rotation.y = turn;
        for (const side of [-1, 1]) {
          const px = x + side * 4.7 * Math.cos(turn);
          rock(px, z - side * 4.7 * Math.sin(turn), 2.3, 810 + side);
          collisions.push({
            x: px,
            z: z - side * 4.7 * Math.sin(turn),
            r: 1.7,
          });
        }
      }
      for (const side of [-1, 1]) {
        const x = side * 8,
          z = -25,
          y = heightAt(x, z);
        box(0.18, 5.5, 0.18, palette.wood, x, y + 2.75, z);
        box(2.4, 0.18, 0.18, palette.wood, x, y + 5.5, z);
        for (let i = 0; i < 7; i++)
          box(
            0.035,
            2.1 + i * 0.24,
            0.035,
            0xd4c295,
            x - 0.9 + i * 0.3,
            y + 4.3 - i * 0.12,
            z,
          );
        collisions.push({ x, z, r: 0.3 });
      }
      windDust = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.06, 0),
        new THREE.MeshBasicMaterial({
          color: 0xf1d1a0,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
        42,
      );
      world.add(windDust);
    } else if (stage === 4) {
      landmarks.push("Линия фонарей", "Луна над сторожевой башней");
      for (let i = 0; i < 8; i++) lamp((i % 2 ? -1 : 1) * 5.6, 22 - i * 11);
      const moon = mesh(
        new THREE.SphereGeometry(4, 20, 12),
        new THREE.MeshBasicMaterial({ color: 0xe8f0d5, fog: false }),
        -4,
        30,
        -160,
      );
      moon.castShadow = false;
      const stars = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.12, 0),
        new THREE.MeshBasicMaterial({ color: 0xe1edf4, fog: false }),
        120,
      );
      for (let i = 0; i < 120; i++) {
        dummy.position.set(
          (random() - 0.5) * 230,
          22 + random() * 52,
          -90 - random() * 140,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.6 + random());
        dummy.updateMatrix();
        stars.setMatrixAt(i, dummy.matrix);
      }
      world.add(stars);
      mesh(
        new THREE.CylinderGeometry(3.4, 4.2, 16, 8),
        mat(palette.stone),
        -15,
        heightAt(-15, -45) + 8,
        -45,
      );
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        box(
          0.9,
          1.6,
          1.0,
          palette.darkStone,
          -15 + Math.cos(a) * 3.0,
          heightAt(-15, -45) + 16.6,
          -45 + Math.sin(a) * 3,
        );
      }
      collisions.push({ x: -15, z: -45, r: 4.2 });
    } else {
      landmarks.push(
        "Бирюзовые городские стены",
        "Мощёная дорога",
        "Купола за туманом",
      );
      const paving = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.95, 0.055, 1.25),
        mat(0xc5c6af),
        288,
      );
      for (let row = 0; row < 48; row++)
        for (let col = 0; col < 6; col++) {
          const z = 10 - row * 1.5,
            c = Math.sin(z * 0.045) * 2.8,
            x = c + (col - 2.5) * 1.02;
          dummy.position.set(x, heightAt(x, z) + 0.045, z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          paving.setMatrixAt(row * 6 + col, dummy.matrix);
        }
      world.add(paving);
      paving.receiveShadow = true;
      for (const side of [-1, 1])
        for (let i = 0; i < 6; i++) {
          const x = side * (14 + (i % 2) * 4),
            z = -10 - i * 10,
            y = heightAt(x, z),
            h = 5 + (i % 3) * 2;
          box(7, h, 7.5, palette.stone, x, y + h / 2, z);
          box(7.3, 0.45, 7.8, 0x598f89, x, y + h, z);
          for (const dz of [-2, 1])
            box(0.06, 1.7, 0.8, 0x426e6b, x - side * 3.53, y + h * 0.6, z + dz);
          if (i % 2 === 0)
            mesh(
              new THREE.SphereGeometry(2.7, 10, 6, 0, TAU, 0, Math.PI / 2),
              mat(0x6aa49b),
              x,
              y + h + 0.23,
              z,
            );
          collisions.push({ x, z, r: 4.8 });
        }
      for (const x of [-7, 7]) {
        box(1.1, 5, 0.3, 0x4d9089, x, gateY + 5.4, gateZ + 2.15);
        lamp(x * 0.65, gateZ + 8, 4);
      }
    }
    renderer.domElement.dataset.landmarks = JSON.stringify(landmarks);
    // Water spring with a rocky rim.
    const waterX = stage % 2 === 0 ? -12 : 13,
      waterZ = -4 - (stage % 3) * 6,
      waterY = heightAt(waterX, waterZ);
    const spring = mesh(
      new THREE.CircleGeometry(2.5, 40),
      new THREE.MeshStandardMaterial({
        color: palette.water,
        roughness: 0.2,
        metalness: 0.18,
        transparent: true,
        opacity: 0.9,
      }),
      waterX,
      waterY + 0.04,
      waterZ,
    );
    spring.rotation.x = -Math.PI / 2;
    spring.castShadow = false;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      rock(
        waterX + Math.cos(a) * 2.7,
        waterZ + Math.sin(a) * 2.7,
        0.55,
        200 + i,
      );
    }
    well = mesh(
      new THREE.TorusGeometry(2.2, 0.025, 4, 50),
      new THREE.MeshBasicMaterial({
        color: 0xa3e0dc,
        transparent: true,
        opacity: 0.35,
      }),
      waterX,
      waterY + 0.07,
      waterZ,
    );
    well.rotation.x = -Math.PI / 2;
    function crate(x: number, z: number, s = 1) {
      const y = heightAt(x, z);
      const group = new THREE.Group();
      group.position.set(x, y, z);
      world.add(group);
      box(s, s * 0.9, s, 0x926947, 0, s * 0.45, 0, group);
      for (const side of [-1, 1]) {
        box(
          0.09,
          s * 0.98,
          s * 1.05,
          0x594631,
          side * s * 0.41,
          s * 0.45,
          0,
          group,
        );
        box(s * 1.05, 0.09, 0.1, 0xba9466, 0, s * 0.87, side * s * 0.41, group);
      }
      collisions.push({ x, z, r: s * 0.65 });
      return group;
    }
    const salvageX = stage % 2 === 0 ? 11 : -12,
      salvageZ = -15 - (stage % 3) * 4;
    crate(salvageX, salvageZ, 1.2);
    crate(salvageX + 1.5, salvageZ - 0.5, 0.8);
    crate(salvageX - 0.5, salvageZ - 1.4, 0.7);
    crate(-8, 23, 0.8);
    crate(-7.1, 24, 0.7);
    const firePos = new THREE.Vector3(5, heightAt(5, 19), 19);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      rock(
        firePos.x + Math.cos(a) * 0.65,
        firePos.z + Math.sin(a) * 0.65,
        0.22,
        320 + i,
      );
    }
    flame = mesh(
      new THREE.ConeGeometry(0.3, 0.9, 5),
      new THREE.MeshBasicMaterial({
        color: 0xffb44e,
        transparent: true,
        opacity: 0.9,
      }),
      firePos.x,
      firePos.y + 0.55,
      firePos.z,
    );
    flame.castShadow = false;
    fireLight = new THREE.PointLight(0xffad55, 5, 9);
    fireLight.position.copy(firePos).add(new THREE.Vector3(0, 1.3, 0));
    world.add(fireLight);
    for (const [id, point] of new Map<InteractionId, THREE.Vector3>([
      ["water", new THREE.Vector3(waterX, waterY, waterZ)],
      [
        "salvage",
        new THREE.Vector3(salvageX, heightAt(salvageX, salvageZ), salvageZ),
      ],
      ["gate", new THREE.Vector3(0, heightAt(0, -51), -51)],
    ]))
      objectives.set(id, point);
    function beacon(point: THREE.Vector3, color: number) {
      const ring = mesh(
        new THREE.TorusGeometry(0.85, 0.035, 6, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
        point.x,
        point.y + 0.12,
        point.z,
      );
      ring.rotation.x = -Math.PI / 2;
      const diamond = mesh(
        new THREE.OctahedronGeometry(0.22),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.5,
          roughness: 0.4,
        }),
        point.x,
        point.y + 2.7,
        point.z,
      );
      glowObjects.push(diamond);
      return ring;
    }
    beacon(objectives.get("water")!, 0x7edddd);
    beacon(objectives.get("salvage")!, 0xe8bd6e);
    beacon(objectives.get("gate")!, 0xffd396);
    if (presentation.encounters) {
      const x = stage === 0 ? waterX : stage === 2 ? salvageX : 0;
      const z = stage === 0 ? waterZ : stage === 2 ? salvageZ : -27;
      const y = heightAt(x, z);
      const task = new THREE.Group();
      task.name = "V2 encounter " + stage;
      task.position.set(x, y, z);
      world.add(task);
      if (stage === 0) {
        for (const side of [-1, 1]) box(0.28, 4.2, 0.3, palette.wood, side * 2.2, 2.1, 0, task);
        box(4.8, 0.3, 0.4, palette.wood, 0, 4.25, 0, task);
        box(0.08, 3.2, 0.08, 0xd3bd91, 0, 2.6, 0, task);
        box(0.9, 0.65, 0.85, 0x64524a, 0, 1.05, 0, task);
      } else if (stage === 1) {
        for (const side of [-1, 1]) {
          box(0.22, 1.2, 11, palette.wood, side * 2.2, 0.85, 0, task);
          for (let i = 0; i < 4; i++) box(0.18, 1.6, 0.18, palette.wood, side * 2.2, 0.8, -4 + i * 2.7, task);
        }
        for (let i = 0; i < 12; i++) if (i !== 5 && i !== 6) box(4.4, 0.18, 0.7, 0x927756, 0, 0.15, -4.5 + i * 0.85, task);
        box(4.1, 0.16, 0.7, 0x70513f, 0.5, 0.26, 0.5, task).rotation.y = 0.36;
      } else if (stage === 2) {
        box(4.8, 3.4, 0.5, palette.stone, 0, 1.7, -2, task);
        for (const side of [-1, 1]) box(0.5, 3.4, 3.7, palette.stone, side * 2.2, 1.7, -0.3, task);
        box(5.2, 0.3, 4, palette.wood, 0, 3.6, -0.3, task);
      } else if (stage === 3) {
        for (const side of [-1, 1]) {
          box(3, 0.35, 0.3, palette.wood, side * 2.8, 1.05, 0, task).rotation.z = side * 0.3;
          box(0.2, 1.8, 0.2, palette.wood, side * 2.8, 0.9, 0, task);
          box(0.55, 0.9, 0.16, 0x934e42, side * 2.8, 1.8, 0, task);
        }
      } else if (stage === 4) {
        for (const side of [-1, 1]) for (const depth of [-1, 1]) box(0.18, 2.6, 0.18, palette.wood, side * 2.5, 1.3, depth * 2, task);
        const tarp = box(5.5, 0.12, 4.4, 0x4d7774, 0, 2.7, 0, task);
        tarp.rotation.z = 0.09;
      } else {
        box(4.8, 0.65, 1.8, palette.wood, 0, 0.35, 0, task);
        for (const side of [-1, 1]) {
          box(0.15, 3.8, 0.15, palette.wood, side * 2.5, 1.9, 0, task);
          box(1.4, 0.9, 0.08, 0x4d9089, side * 2.1, 3.1, 0, task);
        }
      }
      encounterMarker = mesh(new THREE.OctahedronGeometry(0.32), new THREE.MeshStandardMaterial({ color: 0xffd396, emissive: 0xffd396, emissiveIntensity: 0.4 }), x, y + 4.9, z);
      glowObjects.push(encounterMarker);
      const interaction: InteractionId = stage === 0 ? "water" : stage === 2 ? "salvage" : "gate";
      objectives.set(interaction, new THREE.Vector3(x, y, z));
      renderer.domElement.dataset.encounter = String(stage);
      renderer.domElement.dataset.outcome = "pending";
    }
    renderer.domElement.dataset.staticBatches = String(
      batchStatic(
        world,
        new Set<THREE.Object3D>([
          flame,
          well,
          ...glowObjects,
          ...flags.map((flag) => flag.mesh),
        ]),
      ),
    );
  }
  buildLevel();
  let disposed = false,
    paused = true,
    nearby: InteractionId | null = null,
    elapsed = 0,
    yaw = 0.18,
    pitch = 0.22,
    distance = 8.5,
    dragging = false,
    lastX = 0,
    lastY = 0,
    interactUntil = 0;
  let objective: InteractionId = "water";
  const keys = new Set<string>(),
    joystick = new THREE.Vector2(),
    velocity = new THREE.Vector3(),
    position = new THREE.Vector3(0, 0, 26),
    camTarget = new THREE.Vector3();
  const actors: Actor[] = [];
  const loader = new GLTFLoader();
  let hero: Actor | null = null,
    wagon: THREE.Object3D | null = null;
  function play(actor: Actor, clip: string, oneShot = false) {
    if (actor.current === clip && !oneShot) return;
    const next = actor.actions.get(clip);
    if (!next) return;
    actor.actions.get(actor.current)?.fadeOut(0.2);
    next
      .reset()
      .setEffectiveWeight(1)
      .fadeIn(0.2)
      .setLoop(
        oneShot ? THREE.LoopOnce : THREE.LoopRepeat,
        oneShot ? 1 : Infinity,
      );
    next.clampWhenFinished = oneShot;
    next.play();
    actor.current = clip;
  }
  async function loadActor(file: CharacterModel, offset: THREE.Vector3) {
    cb.onProgress("Загружаем персонажей и анимации");
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/characters/${file}-game.glb`);
    if (disposed) {
      disposeTree(gltf.scene);
      return null;
    }
    const model = cloneSkeleton(gltf.scene),
      root = new THREE.Group();
    const bounds = new THREE.Box3().setFromObject(model),
      height = bounds.max.y - bounds.min.y,
      scale = 1.85 / height;
    model.scale.multiplyScalar(scale);
    model.position.y = -bounds.min.y * scale;
    root.add(model);
    scene.add(root);
    root.position.copy(position).add(offset);
    root.position.y = heightAt(root.position.x, root.position.z);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const mixer = new THREE.AnimationMixer(model),
      actions = new Map<string, THREE.AnimationAction>();
    const feet: THREE.SkinnedMesh[] = [];
    model.traverse((object) => {
      if (
        (object as THREE.SkinnedMesh).isSkinnedMesh &&
        /Leg(Left|Right)/i.test(object.name)
      )
        feet.push(object as THREE.SkinnedMesh);
    });
    for (const clip of gltf.animations) {
      const name = clip.name.split("|").at(-1)!;
      actions.set(name, mixer.clipAction(clip));
    }
    const actor = {
      root,
      model,
      mixer,
      actions,
      current: "",
      offset,
      baseModelY: model.position.y,
      feet,
    };
    actors.push(actor);
    play(actor, "Idle");
    root.rotation.y = Math.PI;
    return actor;
  }
  const companions = cast.companions
    .slice(0, 5)
    .filter(
      (item, index, list) =>
        list.findIndex((other) => other.id === item.id) === index,
    );
  function bindActorObjectives() {
    if (wagon) objectives.set("wagon", wagon.position);
    companions.forEach((item, index) => {
      if (actors[index + 1])
        objectives.set(item.id, actors[index + 1].root.position);
    });
  }
  const loading = (async () => {
    hero = await loadActor(cast.hero, new THREE.Vector3());
    if (disposed) return;
    for (let index = 0; index < companions.length; index++) {
      const row = Math.floor(index / 2),
        side = index % 2 ? 1 : -1;
      await loadActor(
        companions[index].model,
        new THREE.Vector3(side * (3 + row * 0.8), 0, 5 + row * 3),
      );
      if (disposed) return;
    }
    cb.onProgress("Готовим караван");
    const asset = await loader.loadAsync(`${import.meta.env.BASE_URL}models/caravan.glb`);
    if (disposed) {
      disposeTree(asset.scene);
      return;
    }
    wagon = asset.scene;
    wagon.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).castShadow = true;
        (o as THREE.Mesh).receiveShadow = true;
      }
    });
    wagon.position.set(-4, heightAt(-4, 17), 17);
    wagon.rotation.y = Math.PI;
    scene.add(wagon);
    renderer.domElement.dataset.wagonBatches = String(batchStatic(wagon));
    // The wagon moves, unlike world batches: raycast its current render meshes.
    wagon.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) cameraBlockers.push(object);
    });
    bindActorObjectives();
    renderer.domElement.dataset.cast = JSON.stringify({
      hero: cast.hero,
      companions,
    });
    cb.onReady();
  })().catch((e) => {
    if (!disposed) cb.onError(`Не удалось загрузить 3D-модели: ${e.message}`);
  });
  // Presentation consumes the authoritative round summary. It never determines
  // actions, damage, transfers, or match progression.
  const resolutionFX = new THREE.Group();
  resolutionFX.visible = false;
  scene.add(resolutionFX);
  const dustMaterial = new THREE.MeshBasicMaterial({
    color: 0xd4b48c,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  });
  const dust = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.18, 0),
    dustMaterial,
    72,
  );
  resolutionFX.add(dust);
  const effectDummy = new THREE.Object3D();
  const shields: THREE.Mesh[] = [],
    actionTokens: THREE.Mesh[] = [],
    debris: THREE.Mesh[] = [];
  function effectMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ) {
    const m = new THREE.Mesh(geometry, material);
    resolutionFX.add(m);
    return m;
  }
  for (let i = 0; i < 6; i++) {
    const shield = effectMesh(
      new THREE.CylinderGeometry(0.65, 0.65, 0.09, 8),
      new THREE.MeshStandardMaterial({
        color: 0x75bfc1,
        emissive: 0x387d89,
        emissiveIntensity: 0.6,
        metalness: 0.35,
        roughness: 0.4,
      }),
    );
    shield.rotation.x = Math.PI / 2;
    shields.push(shield);
    actionTokens.push(
      effectMesh(
        new THREE.OctahedronGeometry(0.28),
        new THREE.MeshStandardMaterial({
          color: 0xe8c381,
          emissive: 0x8c6b24,
          emissiveIntensity: 0.5,
        }),
      ),
    );
  }
  for (let i = 0; i < 8; i++) {
    const m = effectMesh(
      new THREE.IcosahedronGeometry(0.22 + i * 0.035, 0),
      new THREE.MeshStandardMaterial({
        color: 0x786f60,
        roughness: 1,
        flatShading: true,
      }),
    );
    m.castShadow = true;
    debris.push(m);
  }
  const repairHalo = effectMesh(
    new THREE.TorusGeometry(1.4, 0.045, 5, 32),
    new THREE.MeshBasicMaterial({
      color: 0x9de3b7,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  );
  repairHalo.rotation.x = -Math.PI / 2;
  const impactRing = effectMesh(
    new THREE.TorusGeometry(1, 0.05, 5, 32),
    new THREE.MeshBasicMaterial({
      color: 0xe18b65,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    }),
  );
  impactRing.rotation.x = -Math.PI / 2;
  interface ResolutionScene {
    started: number;
    summary: WorldResolution;
    origins: Array<{
      actor: Actor;
      position: THREE.Vector3;
      heading: number;
      target: THREE.Vector3;
    }>;
    wagonOrigin: THREE.Vector3 | null;
    wagonHeading: number;
    focus: THREE.Vector3;
    promise: Promise<void>;
    done(): void;
  }
  let resolution: ResolutionScene | null = null;
  function finishResolution() {
    const active = resolution;
    if (!active) return;
    resolution = null;
    for (const entry of active.origins) {
      entry.actor.root.position.copy(entry.position);
      entry.actor.root.rotation.y = entry.heading;
      play(entry.actor, "Idle");
    }
    if (wagon && active.wagonOrigin) {
      wagon.position.copy(active.wagonOrigin);
      wagon.rotation.y = active.wagonHeading;
    }
    resolutionFX.visible = false;
    camera.fov = 48;
    camera.updateProjectionMatrix();
    renderer.domElement.dataset.resolutionPhase = "complete";
    active.done();
  }
  function playResolution(summary: WorldResolution): Promise<void> {
    if (disposed || !hero || !wagon) return Promise.resolve();
    if (resolution) return resolution.promise;
    blur();
    velocity.set(0, 0, 0);
    const focus = new THREE.Vector3(0, heightAt(0, -43), -43);
    let done!: () => void;
    const promise = new Promise<void>((resolve) => {
      done = resolve;
    });
    const copied = { ...summary, actions: [...summary.actions] };
    camera.fov = companions.length > 3 ? 58 : 52;
    camera.updateProjectionMatrix();
    resolution = {
      started: performance.now(),
      summary: copied,
      focus,
      promise,
      done,
      wagonOrigin: wagon.position.clone(),
      wagonHeading: wagon.rotation.y,
      origins: actors.map((actor, index) => {
        const side = index % 2 ? -1 : 1,
          row = Math.floor(index / 2);
        const action = copied.actions[index] ?? 0;
        const target = focus
          .clone()
          .add(
            new THREE.Vector3(
              side * (action === 3 ? 1.5 : 2.5 + row * 0.6),
              0,
              action === 1 ? -3 - row * 0.6 : -1.1 - row * 0.5,
            ),
          );
        target.y = heightAt(target.x, target.z);
        const entry = {
          actor,
          position: actor.root.position.clone(),
          heading: actor.root.rotation.y,
          target,
        };
        play(actor, "Running_A");
        return entry;
      }),
    };
    resolutionFX.position.copy(focus);
    resolutionFX.visible = true;
    renderer.domElement.dataset.resolution = JSON.stringify(copied);
    renderer.domElement.dataset.resolutionPhase = "actions";
    return promise;
  }
  function tickResolution(time: number) {
    const active = resolution;
    if (!active) return;
    const t = Math.max(0, (time - active.started) / 1000),
      p = Math.min(1, t / 3.2);
    const arrival = THREE.MathUtils.smoothstep(t, 0, 0.65);
    for (const entry of active.origins) {
      entry.actor.root.position.lerpVectors(
        entry.position,
        entry.target,
        arrival,
      );
      const index = active.origins.indexOf(entry),
        action = active.summary.actions[index] ?? 0;
      if (t < 0.65) {
        const delta = entry.target.clone().sub(entry.position);
        entry.actor.root.rotation.y = Math.atan2(delta.x, delta.z);
        const clip = delta.length() > 3 ? "Running_A" : "Walking_A";
        play(entry.actor, clip);
        entry.actor.actions
          .get(clip)
          ?.setEffectiveTimeScale(
            Math.max(
              0.7,
              delta.length() / 0.65 / (clip === "Running_A" ? 3.8 : 1.9),
            ),
          );
      } else {
        entry.actor.root.rotation.y = Math.PI;
        const clip =
          action === 1
            ? "Blocking"
            : action === 3
              ? "Interact"
              : action === 2 || action === 4 || action === 5 || action === 6
                ? "PickUp"
                : "Idle";
        play(entry.actor, clip);
        entry.actor.actions.get(clip)?.setEffectiveTimeScale(1);
      }
    }
    if (wagon && active.wagonOrigin) {
      wagon.position.lerpVectors(active.wagonOrigin, active.focus, arrival);
      wagon.rotation.y =
        Math.PI +
        (active.summary.hullAfter < active.summary.hullBefore &&
        t > 1.3 &&
        t < 2.1
          ? Math.sin(t * 43) * 0.025
          : 0);
    }
    shields.forEach((shield, index) => {
      const actor = active.origins[index]?.actor;
      shield.visible = !!actor && active.summary.actions[index] === 1;
      if (actor)
        shield.position
          .copy(actor.root.position)
          .sub(active.focus)
          .add(new THREE.Vector3(0, 0.95, -0.6));
      shield.scale.setScalar(1 + Math.sin(t * 8 + index) * 0.025);
    });
    actionTokens.forEach((token, index) => {
      const entry = active.origins[index],
        action = active.summary.actions[index] ?? 0;
      token.visible =
        !!entry &&
        (action === 2 || action === 3 || action === 4) &&
        t > 0.6 &&
        t < 2.8;
      if (!entry) return;
      const transfer = THREE.MathUtils.smoothstep(t, 1.2, 2.6);
      const local = entry.actor.root.position.clone().sub(active.focus);
      token.position.copy(local).lerp(new THREE.Vector3(0, 1.2, 0), transfer);
      token.position.y += 1.1 + Math.sin(transfer * Math.PI) * 1.2;
      token.rotation.y = t * 2;
      (token.material as THREE.MeshStandardMaterial).color.setHex(
        action === 2 ? 0x76d2db : action === 3 ? 0xb8e3c3 : 0xe8c381,
      );
    });
    repairHalo.visible = active.summary.actions.includes(3) && t > 0.8;
    repairHalo.position.set(0, 0.15 + Math.sin(t * 4) * 0.05, 0);
    repairHalo.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
    const impact = active.summary.hullAfter < active.summary.hullBefore;
    impactRing.visible = impact && t > 1.4 && t < 2.6;
    impactRing.position.y = 0.08;
    impactRing.scale.setScalar(1 + (t - 1.4) * 4);
    (impactRing.material as THREE.MeshBasicMaterial).opacity = Math.max(
      0,
      0.7 - (t - 1.4) * 0.55,
    );
    debris.forEach((stone, index) => {
      stone.visible = active.summary.threat > 0 && t > 0.7 && t < 2.7;
      const fall = THREE.MathUtils.clamp((t - 0.7 - index * 0.07) / 0.9, 0, 1);
      const side = index % 2 ? -1 : 1;
      stone.position.set(
        side * (3.4 - fall * 1.7),
        7 * (1 - fall * fall) + 0.3,
        -2 + index * 0.5,
      );
      stone.rotation.set(fall * 4, index + fall * 2, fall);
    });
    dustMaterial.opacity =
      Math.max(0, Math.sin(p * Math.PI)) *
      (active.summary.threat > 0 ? 0.4 : 0.16);
    for (let i = 0; i < dust.count; i++) {
      const a = i * 2.39996,
        age = THREE.MathUtils.clamp(t - 0.8 - (i % 9) * 0.045, 0, 2);
      const r = 1.3 + age * (1.4 + (i % 5) * 0.3);
      effectDummy.position.set(
        Math.cos(a) * r,
        0.2 + age * (0.4 + (i % 3) * 0.18),
        Math.sin(a) * r,
      );
      effectDummy.scale.setScalar(0.5 + age * 1.2);
      effectDummy.updateMatrix();
      dust.setMatrixAt(i, effectDummy.matrix);
    }
    dust.instanceMatrix.needsUpdate = true;
    renderer.domElement.dataset.resolutionPhase =
      t < 1.3 ? "actions" : t < 2.3 ? "danger" : "consequence";
    if (t >= 3.2) finishResolution();
  }
  const interact = () => {
    if (!paused && !resolution && nearby) cb.onInteract(nearby);
  };
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  const pointerGap = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const keydown = (e: KeyboardEvent) => {
    if (paused || resolution) return;
    if (
      e.target instanceof Element &&
      e.target.closest("input,select,textarea,dialog")
    )
      return;
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(e.code)
    )
      e.preventDefault();
    keys.add(e.code);
    if (e.code === "KeyE" && !e.repeat) interact();
  };
  const keyup = (e: KeyboardEvent) => keys.delete(e.code);
  const blur = () => {
    keys.clear();
    joystick.set(0, 0);
    dragging = false;
    pointers.clear();
    pinchDistance = 0;
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinchDistance = pointerGap();
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try {
      renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic test events have no native pointer capture. */
    }
    renderer.domElement.focus();
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size > 1) {
      const gap = pointerGap();
      distance = THREE.MathUtils.clamp(
        distance + (pinchDistance - gap) * 0.025,
        4,
        15,
      );
      pinchDistance = gap;
      return;
    }
    yaw -= (e.clientX - lastX) * 0.006;
    pitch = THREE.MathUtils.clamp(
      pitch + (e.clientY - lastY) * 0.004,
      0.08,
      1.15,
    );
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    const remaining = [...pointers.values()][0];
    dragging = !!remaining;
    pinchDistance = pointerGap();
    if (remaining) {
      lastX = remaining.x;
      lastY = remaining.y;
    }
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    distance = THREE.MathUtils.clamp(distance + e.deltaY * 0.009, 4, 15);
  };
  const prevent = (e: Event) => e.preventDefault();
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", blur);
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointermove", move);
  renderer.domElement.addEventListener("pointerup", up);
  renderer.domElement.addEventListener("pointercancel", up);
  renderer.domElement.addEventListener("wheel", wheel, { passive: false });
  renderer.domElement.addEventListener("contextmenu", prevent);
  const resize = () => {
    if (!host.clientWidth || !host.clientHeight) return;
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  let prev = performance.now(),
    hudAt = 0,
    frames = 0,
    frameSum = 0,
    statsAt = prev;
  camera.position.set(6, 5, 34);
  renderer.setAnimationLoop((time) => {
    if (disposed) return;
    const rawDt = Math.max(0, (time - prev) / 1000),
      dt = Math.min(rawDt, 0.05);
    prev = time;
    elapsed += dt;
    frames++;
    frameSum += rawDt;
    const locked = paused || !!resolution;
    const ix = locked
        ? 0
        : Number(keys.has("KeyD") || keys.has("ArrowRight")) -
          Number(keys.has("KeyA") || keys.has("ArrowLeft")) +
          joystick.x,
      iz = locked
        ? 0
        : Number(keys.has("KeyS") || keys.has("ArrowDown")) -
          Number(keys.has("KeyW") || keys.has("ArrowUp")) +
          joystick.y;
    const input = new THREE.Vector2(ix, iz);
    if (input.length() > 1) input.normalize();
    const running = keys.has("ShiftLeft") || keys.has("ShiftRight"),
      speed = running ? 5.0 : 3.0;
    const desired = new THREE.Vector3(
      Math.cos(yaw) * input.x + Math.sin(yaw) * input.y,
      0,
      -Math.sin(yaw) * input.x + Math.cos(yaw) * input.y,
    ).multiplyScalar(speed);
    velocity.lerp(desired, 1 - Math.exp(-dt * 13));
    const candidate = position.clone().addScaledVector(velocity, dt);
    candidate.x = THREE.MathUtils.clamp(candidate.x, -24, 24);
    candidate.z = THREE.MathUtils.clamp(candidate.z, -67, 38);
    for (const c of collisions) {
      const dx = candidate.x - c.x,
        dz = candidate.z - c.z,
        d = Math.hypot(dx, dz),
        min = c.r + 0.32;
      if (d < min && d > 0.001) {
        candidate.x = c.x + (dx / d) * min;
        candidate.z = c.z + (dz / d) * min;
      }
    }
    for (const a of actors.slice(1)) {
      const dx = candidate.x - a.root.position.x,
        dz = candidate.z - a.root.position.z,
        d = Math.hypot(dx, dz);
      if (d < 0.6 && d > 0.001) {
        candidate.x = a.root.position.x + (dx / d) * 0.6;
        candidate.z = a.root.position.z + (dz / d) * 0.6;
      }
    }
    if (wagon) {
      const dx = candidate.x - wagon.position.x,
        dz = candidate.z - wagon.position.z,
        d = Math.hypot(dx, dz);
      if (d < 1.9 && d > 0.001) {
        candidate.x = wagon.position.x + (dx / d) * 1.9;
        candidate.z = wagon.position.z + (dz / d) * 1.9;
      }
    }
    if (!locked) position.copy(candidate);
    position.y = heightAt(position.x, position.z);
    if (hero && !resolution) {
      hero.root.position.copy(position);
      if (velocity.length() > 0.12) {
        const target = Math.atan2(velocity.x, velocity.z),
          angle =
            THREE.MathUtils.euclideanModulo(
              target - hero.root.rotation.y + Math.PI,
              TAU,
            ) - Math.PI;
        hero.root.rotation.y += angle * (1 - Math.exp(-dt * 14));
        if (elapsed >= interactUntil)
          play(hero, running ? "Running_A" : "Walking_A");
      } else if (elapsed >= interactUntil) play(hero, "Idle");
      hero.actions
        .get(hero.current)
        ?.setEffectiveTimeScale(
          hero.current === "Walking_A"
            ? Math.max(0.3, velocity.length() / 1.9)
            : hero.current === "Running_A"
              ? Math.max(0.3, velocity.length() / 3.8)
              : 1,
        );
    }
    for (let i = 1; i < actors.length; i++) {
      if (resolution) break;
      const a = actors[i];
      const target = position
        .clone()
        .add(
          new THREE.Vector3(
            (i % 2 ? -1 : 1) * (3 + Math.floor((i - 1) / 2) * 0.8),
            0,
            4 + i * 1.7,
          ),
        );
      const delta = target.sub(a.root.position);
      delta.y = 0;
      const d = delta.length();
      if (
        !locked &&
        position.z < 13 &&
        d > 2 &&
        Math.hypot(
          position.x - a.root.position.x,
          position.z - a.root.position.z,
        ) > 4.5
      ) {
        const step = Math.min(d, dt * 3);
        delta.normalize();
        a.root.position.addScaledVector(delta, step);
        for (const c of collisions) {
          const dx = a.root.position.x - c.x,
            dz = a.root.position.z - c.z,
            gap = Math.hypot(dx, dz),
            radius = c.r + 0.3;
          if (gap < radius && gap > 0.001) {
            a.root.position.x = c.x + (dx / gap) * radius;
            a.root.position.z = c.z + (dz / gap) * radius;
          }
        }
        a.root.position.y = heightAt(a.root.position.x, a.root.position.z);
        a.root.rotation.y = Math.atan2(delta.x, delta.z);
        play(a, "Walking_A");
        a.actions.get("Walking_A")?.setEffectiveTimeScale(1.5);
      } else play(a, "Idle");
    }
    tickResolution(time);
    for (const a of actors) {
      a.mixer.update(dt);
      a.model.position.y = a.baseModelY;
      // Imported interaction poses dip the feet a few centimetres below their
      // rest plane. Lift only penetrating stationary poses, preserving airborne
      // running frames and the source mesh proportions.
      if (
        ["Interact", "PickUp", "Blocking"].includes(a.current) &&
        a.feet.length
      ) {
        // SkinnedMesh's updateMatrixWorld override also refreshes its attached
        // bind inverse. updateWorldMatrix would leave the previous lift in it.
        a.root.updateMatrixWorld(true);
        const skeletons = new Set(a.feet.map((foot) => foot.skeleton));
        skeletons.forEach((skeleton) => skeleton.update());
        let low = Infinity;
        for (const foot of a.feet) {
          foot.computeBoundingBox();
          if (foot.boundingBox)
            low = Math.min(
              low,
              foot.boundingBox.clone().applyMatrix4(foot.matrixWorld).min.y,
            );
        }
        if (Number.isFinite(low))
          a.model.position.y += Math.max(0, a.root.position.y - low - 0.002);
      }
      if (a === hero) {
        const correction = String(
          +(a.model.position.y - a.baseModelY).toFixed(4),
        );
        if (renderer.domElement.dataset.groundCorrection !== correction)
          renderer.domElement.dataset.groundCorrection = correction;
      }
    }
    if (wagon && !locked && position.z < 9) {
      const targetZ = position.z + 11;
      if (wagon.position.z > targetZ) {
        wagon.position.z = Math.max(
          targetZ,
          wagon.position.z - dt * Math.max(3.3, velocity.length() + 0.5),
        );
        wagon.position.x = Math.sin(wagon.position.z * 0.045) * 2.8;
        wagon.position.y = heightAt(wagon.position.x, wagon.position.z);
      }
    }
    camTarget.copy(position).add(new THREE.Vector3(0, 1.25, 0));
    const cinematic = resolution
      ? THREE.MathUtils.smoothstep((time - resolution.started) / 1000, 0, 0.7)
      : 0;
    if (resolution)
      camTarget.lerp(
        resolution.focus.clone().add(new THREE.Vector3(0, 1.4, 0)),
        cinematic,
      );
    const targetPos = camTarget
      .clone()
      .add(
        new THREE.Vector3(
          Math.sin(yaw) * Math.cos(pitch) * distance,
          Math.sin(pitch) * distance,
          Math.cos(yaw) * Math.cos(pitch) * distance,
        ),
      );
    if (resolution) {
      const framingScale = Math.max(1, 0.95 / camera.aspect);
      const cinematicPosition = resolution.focus
        .clone()
        .add(
          new THREE.Vector3(
            framingScale > 1 ? 0 : 1,
            5.2 + framingScale - 1,
            -11 * framingScale,
          ),
        );
      targetPos.lerp(cinematicPosition, cinematic);
    }
    targetPos.y = Math.max(
      targetPos.y,
      heightAt(targetPos.x, targetPos.z) + 0.6,
    );
    const cameraDirection = targetPos.clone().sub(camTarget);
    cameraRay.set(camTarget, cameraDirection.clone().normalize());
    cameraRay.near = 0.08;
    cameraRay.far = cameraDirection.length();
    const obstruction = resolution
      ? undefined
      : cameraRay.intersectObjects(cameraBlockers, false)[0];
    if (obstruction) {
      targetPos
        .copy(camTarget)
        .addScaledVector(
          cameraDirection.normalize(),
          Math.max(0.6, obstruction.distance - 0.3),
        );
      camera.position.copy(targetPos);
    } else if (resolution) camera.position.copy(targetPos);
    else camera.position.lerp(targetPos, 1 - Math.exp(-dt * 8));
    camera.lookAt(camTarget);
    const lightingCenter = resolution?.focus ?? position;
    sun.target.position.copy(lightingCenter);
    sun.position.copy(lightingCenter).add(new THREE.Vector3(-35, 65, 30));
    for (const f of flags) {
      const attr = f.mesh.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        const x = f.base[i * 3],
          y = f.base[i * 3 + 1];
        attr.setZ(i, Math.sin(elapsed * 2.1 + x * 4 + y) * 0.12 * x);
      }
      attr.needsUpdate = true;
    }
    if (windDust) {
      for (let i = 0; i < windDust.count; i++) {
        const x =
          THREE.MathUtils.euclideanModulo(i * 11.17 + elapsed * 7, 54) - 27;
        const z = -62 + THREE.MathUtils.euclideanModulo(i * 7.13, 93);
        effectDummy.position.set(x, heightAt(x, z) + 0.3 + (i % 7) * 0.13, z);
        effectDummy.rotation.set(0, elapsed + i, 0);
        effectDummy.scale.set(1.5 + (i % 3), 0.7, 0.7);
        effectDummy.updateMatrix();
        windDust.setMatrixAt(i, effectDummy.matrix);
      }
      windDust.instanceMatrix.needsUpdate = true;
    }
    flame.scale.y = 1 + Math.sin(elapsed * 9) * 0.15;
    fireLight.intensity = 5 + Math.sin(elapsed * 7) * 0.5;
    well.scale.setScalar(1 + Math.sin(elapsed * 1.6) * 0.025);
    glowObjects.forEach((o, i) => {
      o.rotation.y = elapsed * 0.7;
      o.position.y =
        2.8 +
        heightAt(o.position.x, o.position.z) +
        Math.sin(elapsed * 2 + i) * 0.13;
    });
    if (time - hudAt > 120) {
      hudAt = time;
      const guide = objectives.get(objective);
      if (guide) {
        const dx = guide.x - position.x,
          dz = guide.z - position.z;
        cb.onGuide?.(
          Math.round(Math.hypot(dx, dz)),
          Math.round(((Math.atan2(dx, -dz) + yaw) * 180) / Math.PI),
        );
      }
      let best: InteractionId | null = null,
        bestDistance = 4;
      for (const [id, p] of objectives) {
        const d = Math.hypot(position.x - p.x, position.z - p.z);
        const rank =
          d - (["water", "salvage", "gate", "wagon"].includes(id) ? 1 : 0);
        if (d < 3.5 && rank < bestDistance) {
          best = id;
          bestDistance = rank;
        }
      }
      if (!resolution && best !== nearby) {
        nearby = best;
        cb.onNearby(best);
      }
      renderer.domElement.dataset.position = JSON.stringify([
        +position.x.toFixed(2),
        +position.y.toFixed(2),
        +position.z.toFixed(2),
      ]);
      renderer.domElement.dataset.camera = JSON.stringify([
        +yaw.toFixed(2),
        +pitch.toFixed(2),
        +distance.toFixed(2),
      ]);
      renderer.domElement.dataset.animation = hero?.current ?? "loading";
    }
    renderer.render(scene, camera);
    if (time - statsAt > 2000) {
      renderer.domElement.dataset.fps = String(
        Math.round(frames / Math.max(frameSum, 0.001)),
      );
      renderer.domElement.dataset.triangles = String(
        renderer.info.render.triangles,
      );
      renderer.domElement.dataset.drawcalls = String(
        renderer.info.render.calls,
      );
      if (hero) {
        let low = Infinity;
        hero.model.traverse((o) => {
          const m = o as THREE.SkinnedMesh;
          if (m.isSkinnedMesh && /Leg/i.test(m.name)) {
            m.computeBoundingBox();
            if (m.boundingBox)
              low = Math.min(
                low,
                m.boundingBox.clone().applyMatrix4(m.matrixWorld).min.y,
              );
          }
        });
        renderer.domElement.dataset.footclearance = String(
          +(low - hero.root.position.y).toFixed(4),
        );
      }
      frames = 0;
      frameSum = 0;
      statsAt = time;
    }
  });
  const controller: WorldController = {
    setAccessibleLabel(label){renderer.domElement.setAttribute('aria-label',label);},
    playResolution,
    setPaused(v) {
      paused = v;
      if (v) {
        blur();
        velocity.set(0, 0, 0);
      }
    },
    setJoystick(x, z) {
      joystick.set(x, z);
    },
    setStage(value) {
      finishResolution();
      const nextStage = Math.max(0, Math.min(5, Math.trunc(value)));
      if (nextStage !== stage) {
        stage = nextStage;
        buildLevel();
        if (wagon)
          wagon.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) cameraBlockers.push(o);
          });
        bindActorObjectives();
      }
      position.set(0, 0, 26);
      velocity.set(0, 0, 0);
      actors.forEach((a, i) => {
        a.root.position.copy(position).add(a.offset);
        a.root.position.y = heightAt(a.root.position.x, a.root.position.z);
      });
      if (wagon) wagon.position.set(-4, heightAt(-4, 17), 17);
      nearby = null;
      cb.onNearby(null);
      blur();
    },
    interact,
    animateInteraction() {
      if (hero) {
        play(hero, "Interact", true);
        interactUntil = elapsed + 1.2;
      }
    },
    resetCamera() {
      yaw = 0.18;
      pitch = 0.22;
      distance = 8.5;
    },
    setObjective(id) {
      objective = id;
    },
    setEncounterOutcome(value) {
      encounterOutcome = value;
      renderer.domElement.dataset.outcome = value === null ? "pending" : value ? "fulfilled" : "unfulfilled";
      if (encounterMarker) {
        const material = encounterMarker.material as THREE.MeshStandardMaterial;
        const color = value === null ? 0xffd396 : value ? 0x81c8c0 : 0xd49a89;
        material.color.setHex(color);
        material.emissive.setHex(color);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      finishResolution();
      renderer.setAnimationLoop(null);
      observer.disconnect();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointercancel", up);
      renderer.domElement.removeEventListener("wheel", wheel);
      renderer.domElement.removeEventListener("contextmenu", prevent);
      actors.forEach((a) => {
        a.mixer.stopAllAction();
        a.mixer.uncacheRoot(a.model);
      });
      sun.shadow.dispose();
      disposeTree(scene);
      scene.clear();
      world.clear();
      cameraBlockers.length = 0;
      collisions.length = 0;
      flags.length = 0;
      glowObjects.length = 0;
      actors.length = 0;
      hero = null;
      wagon = null;
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return controller;
}
