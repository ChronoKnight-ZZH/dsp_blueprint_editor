/**
 * BlueprintViewer 最小 demo（阶段 B 验证页）。
 *
 * 目的：证明 `new BlueprintViewer({ container })` + `loadBlueprint(str)` 这条
 * 主链路能在真实浏览器里跑通——单测与 build 都验证不了 WebGL 实际渲染效果。
 * 并对齐 v1 的 18 条实例方法 + 新增的 `focusBuilding`（镜头居中对齐）。
 *
 * 访问：`yarn serve` 后打开 http://localhost:8080/dsp_blueprint_editor/demo/
 * （publicPath 是 /dsp_blueprint_editor/，见 vue.config.js）
 */
import { BlueprintViewer } from '@/lib';
import type { BlueprintLoadOutcome, ViewerError } from '@/lib';

const container = document.getElementById('viewer')!;
const logEl = document.getElementById('log')!;
const resultEl = document.getElementById('result')!;
const blueprintInput = document.getElementById('blueprint') as HTMLTextAreaElement;
const showRealModelsEl = document.getElementById('showRealModels') as HTMLInputElement;
const texturesEnabledEl = document.getElementById('texturesEnabled') as HTMLInputElement;
const maxInstancesEl = document.getElementById('maxInstances') as HTMLInputElement;

function log(msg: string, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

function showResult(outcome: BlueprintLoadOutcome) {
    resultEl.className = outcome.ok ? 'ok' : 'err';
    if (outcome.ok) {
        const v = outcome.value;
        resultEl.textContent =
            `✓ ok：buildingCount=${v.buildingCount}，areas=${v.areas.length}，` +
            `header.shortDesc="${v.header.shortDesc}"，` +
            `unknownModelIndexes=[${v.unknownModelIndexes.join(', ')}]`;
    } else {
        const e = outcome.error;
        resultEl.textContent = `✗ ${e.code}（phase=${e.phase}）：${e.message}`;
    }
}

// ---------------------------------------------------------------- Viewer 实例

let viewer: BlueprintViewer | null = null;

function readSettings() {
    return {
        showRealModels: showRealModelsEl.checked,
        texturesEnabled: texturesEnabledEl.checked,
        maxInstancesPerModel: Number(maxInstancesEl.value) || Infinity,
    };
}

function createViewer() {
    viewer = new BlueprintViewer(
        { container: '#viewer', ...readSettings() },
        {
            // 对齐后回传 { index, id }：id 是建筑ID（BlueprintBuilding.index），索引是数组下标
            onBuildingSelect: pick => log(pick === null
                ? 'onBuildingSelect: 点空'
                : `onBuildingSelect: buildingId=${pick.id} index=${pick.index}`),
            onCameraChange: () => { /* 高频回调，不打日志 */ },
            onRebuild: info => log(`onRebuild: reason=${info.reason} buildings=${info.buildingCount} ${info.durationMs}ms`),
            onError: (e: ViewerError) => log(`onError: ${e.code} (${e.phase}) ${e.message}`, 'err'),
        },
    );
    log('new BlueprintViewer(...) 完成');
}

function loadBlueprint(str: string) {
    if (viewer === null) return;
    const t0 = performance.now();
    const outcome = viewer.loadBlueprint(str);
    showResult(outcome);
    log(`loadBlueprint 返回 ${outcome.ok ? 'ok' : outcome.error.code}，耗时 ${(performance.now() - t0).toFixed(0)}ms`);
}

// ---------------------------------------------------------------- 事件绑定

document.getElementById('btnCreate')!.addEventListener('click', () => {
    if (viewer !== null) {
        log('viewer 已存在，先 dispose', 'err');
        return;
    }
    createViewer();
});

document.getElementById('btnLoad')!.addEventListener('click', () => {
    loadBlueprint(blueprintInput.value);
});

document.getElementById('btnLoadFixture')!.addEventListener('click', async () => {
    // 页面在 /dsp_blueprint_editor/demo.html，fixture 在 public/demo/ 下，
    // 相对本页的路径是 demo/sample_throughput.txt（不依赖 publicPath 的绝对值）
    const res = await fetch('demo/sample_throughput.txt');
    if (!res.ok) {
        log(`fetch fixture 失败：${res.status}`, 'err');
        return;
    }
    blueprintInput.value = (await res.text()).trim();
    loadBlueprint(blueprintInput.value);
});

document.getElementById('btnBadString')!.addEventListener('click', () => {
    loadBlueprint('BLUEPRINT:not-a-real-blueprint');
});

document.getElementById('btnResetCamera')!.addEventListener('click', () => {
    viewer?.resetCamera();
    log('resetCamera()');
});

document.getElementById('btnDispose')!.addEventListener('click', () => {
    if (viewer === null) {
        log('viewer 不存在', 'err');
        return;
    }
    viewer.dispose();
    viewer = null;
    log('dispose() 完成；canvas 残留数=' + container.querySelectorAll('canvas').length);
});

// 三个设置任一变化 → setRenderSettings（showRealModels/maxInstances 重建，textures 原地重挂）
for (const el of [showRealModelsEl, texturesEnabledEl, maxInstancesEl]) {
    el.addEventListener('change', () => {
        if (viewer === null) return;
        const settings = readSettings();
        viewer.setRenderSettings(settings);
        log(`setRenderSettings(${JSON.stringify(settings)})`);
    });
}

// 加载后顺带验证 getBlueprintData / dispose 后再调用返回 already-disposed
document.getElementById('btnGetData')!.addEventListener('click', () => {
    const data = viewer === null ? null : viewer.getBlueprintData();
    log(`getBlueprintData(): ${data === null ? 'null' : `buildings=${data.buildings.length}`}`);
});

// ---------------------------------------------------------------- 选中 / 定位

function reportLocate(label: string, r: { ok: true; index: number } | { ok: false; error: ViewerError }) {
    log(r.ok
        ? `${label} → ok, index=${r.index}`
        : `${label} → ${r.error.code}: ${r.error.message}`, r.ok ? '' : 'err');
}

document.getElementById('btnSelect3')!.addEventListener('click', () => {
    if (viewer === null) return log('viewer 不存在', 'err');
    reportLocate('selectBuilding(3)', viewer.selectBuilding(3));
});

document.getElementById('btnSelectNull')!.addEventListener('click', () => {
    if (viewer === null) return log('viewer 不存在', 'err');
    reportLocate('selectBuilding(null)', viewer.selectBuilding(null));
});

document.getElementById('btnFocus3')!.addEventListener('click', () => {
    if (viewer === null) return log('viewer 不存在', 'err');
    const v0 = viewer.getCameraVersion();
    reportLocate('focusBuilding(3)', viewer.focusBuilding(3));
    const cam = viewer.getCamera();
    log(`cameraVersion: ${v0} → ${viewer.getCameraVersion()}，selectedIndex=${viewer.getSelectedIndex()}`
        + (cam === null ? '' : `，相机到球心 ${cam.position.length().toFixed(1)}（离地 ≈ ${(cam.position.length() - 200.2).toFixed(1)}）`));
    log('聚焦不锁镜头：现在可直接滚轮缩放 / 拖拽旋转');
});

document.getElementById('btnFocusNull')!.addEventListener('click', () => {
    if (viewer === null) return log('viewer 不存在', 'err');
    reportLocate('focusBuilding(null) → resetCamera', viewer.focusBuilding(null));
});

document.getElementById('btnSelectedIndex')!.addEventListener('click', () => {
    const index = viewer === null ? null : viewer.getSelectedIndex();
    log(`getSelectedIndex(): ${index === null ? 'null（无选中）' : index}`);
});

document.getElementById('btnBuildingInfo')!.addEventListener('click', () => {
    if (viewer === null) return log('viewer 不存在', 'err');
    const out = viewer.getBuildingInfo(3);
    if (!out.ok) return log(`getBuildingInfo(3) → ${out.error.code}: ${out.error.message}`, 'err');
    const { index, id, matrix } = out.value;
    const pos = matrix.elements.slice(12, 15).map(n => n.toFixed(2)).join(', ');
    log(`getBuildingInfo(3): index=${index} id=${id} 位置=(${pos})`);
});

document.getElementById('btnCameraVersion')!.addEventListener('click', () => {
    log(`getCameraVersion(): ${viewer === null ? 0 : viewer.getCameraVersion()}`);
});

// ---------------------------------------------------------------- 尺寸 / 画布

document.getElementById('btnSetSize')!.addEventListener('click', () => {
    viewer?.setSize(400, 300);
    log('setSize(400, 300)：此后容器 resize 不再覆盖尺寸（用 resetSize 恢复）');
});

document.getElementById('btnResetSize')!.addEventListener('click', () => {
    viewer?.resetSize();
    log('resetSize()：恢复跟随容器尺寸');
});

document.getElementById('btnGetCanvas')!.addEventListener('click', () => {
    const canvas = viewer === null ? null : viewer.getCanvas();
    log(canvas === null
        ? 'getCanvas(): null'
        : `getCanvas(): <${canvas.tagName.toLowerCase()}> ${canvas.width}×${canvas.height}（CSS 尺寸 ${canvas.clientWidth}×${canvas.clientHeight}）`);
});

// ---------------------------------------------------------------- 主题 / 导出

for (const [id, theme] of [['btnThemeDark', 'dark'], ['btnThemeLight', 'light'], ['btnThemeAuto', 'auto']] as const) {
    document.getElementById(id)!.addEventListener('click', () => {
        viewer?.setTheme(theme);
        log(`setTheme('${theme}')`);
    });
}

document.getElementById('btnGetTheme')!.addEventListener('click', () => {
    const t = viewer === null ? null : viewer.getTheme();
    log(t === null
        ? 'getTheme(): null'
        : `getTheme(): bg=#${t.sceneBackground.toString(16)} planet=#${t.planet.toString(16)} grid=#${t.grid.toString(16)} text=${t.textFill}/${t.textStroke}`);
});

document.getElementById('btnDataURL')!.addEventListener('click', () => {
    const url = viewer === null ? null : viewer.toDataURL();
    log(url === null
        ? 'toDataURL(): null'
        : `toDataURL(): ${url.slice(0, 40)}…（长度 ${url.length}，${url.length > 64 ? '非空白' : '可能为空白图'}）`);
});

document.getElementById('btnToBlob')!.addEventListener('click', async () => {
    const blob = viewer === null ? null : await viewer.toBlob();
    log(blob === null ? 'toBlob(): null' : `toBlob(): ${blob.type} ${blob.size} bytes`);
});

// 启动即创建 viewer，加载 fixture（demo 的最短路径）
createViewer();
void (async () => {
    try {
        const res = await fetch('demo/sample_throughput.txt');
        if (res.ok) {
            blueprintInput.value = (await res.text()).trim();
            loadBlueprint(blueprintInput.value);
        }
    } catch (e) {
        log(`自动加载 fixture 失败：${String(e)}`, 'err');
    }
})();
