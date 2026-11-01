/**
 * 资产解析层的契约。
 *
 * 背景：渲染内核原先直接在 `glbAssets.ts` / `textureManifest.ts` / `data/icons.ts`
 * 三处写死 webpack 专属的资产引用方式（`require.context` / 模板字符串 `import()`），
 * 于是「打成单文件库给宿主用」时资产会被烧进 bundle 或被拆成无法外置的 chunk。
 *
 * 这里把「逻辑资产标识 → 可加载 URL」抽成一个接口，构建期用 `resolve.alias`
 * 选择实现（见 `scripts/lib-build/build.js` 与 `vue.config.js`）：
 *
 * - `assetResolver.webpack.ts`：编辑器构建。保留 `require.context` / `require` /
 *   模板字符串 `import()`，行为与改造前逐字节一致（publicPath、contenthash 文件名都不变）。
 * - `assetResolver.ts`：库构建（UMD/ESM）。纯字符串拼接 + 构建期注入的资产清单，
 *   资产目录由宿主页面按 `assetBaseUrl` 自行定位。
 *
 * 两个实现都必须满足本接口；`assetResolver.webpack.ts` 显式标注类型，
 * 由 `tsc` 兜住两个实现之间的形状漂移。
 */

/** 一个资产清单：全部路径都相对 `src/assets/` 目录，例如 `models/smelter.glb`、`icons/tech/1001.png`。 */
export interface AssetInventory {
    /** 建筑 GLB：`models/<name>.glb` */
    readonly models: readonly string[];
    /** 物品/配方图标：`icons/item_recipe/<icon>.png` */
    readonly itemRecipe: readonly string[];
    /** 科技图标：`icons/tech/<id>.png` */
    readonly tech: readonly string[];
    /** 信号图标：`icons/signal/signal-<id>.png` */
    readonly signal: readonly string[];
}

export interface AssetResolver {
    /** 构建产物里真实存在的 GLB 模型名（不含目录与扩展名），例如 `smelter`、`turret-laser` */
    glbModelNames(): readonly string[];

    /** 模型名 → 最终 URL；模型不存在时返回 `null`（调用方静默回退元数据表） */
    glbModelUrl(name: string): Promise<string | null>;

    /**
     * `src/` 相对路径（例如 `assets/icons/models/accumulator/accumulator-n.png`）
     * → 通道贴图的最终 URL；路径不在预期布局内时返回 `null`。
     */
    modelTextureUrl(srcRelativePath: string): string | null;

    /** 物品/配方图标名（不含扩展名）→ URL；图标不存在时 reject */
    itemRecipeIconUrl(name: string): Promise<string>;

    /** 科技图标 id → URL；图标不存在时 reject */
    techIconUrl(techId: number): Promise<string>;

    /** 信号图标 id（如 401）→ URL；图标不存在时 reject */
    signalIconUrl(signalId: number): Promise<string>;
}
