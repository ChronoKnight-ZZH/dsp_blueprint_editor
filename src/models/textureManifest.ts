/**
 * 材质外部通道贴图清单（**当前为空**）
 *
 * 背景：法线（`-n`）/ 自发光（`-e`）/ spec-gloss（`-s`）三张贴图已全部内嵌进
 * `src/assets/icons/models/*.glb`（KTX2，见 `scripts/glb-ktx2/`）。运行时
 * [materialTextures](./materialTextures.ts) 优先使用 GLB 内嵌贴图，这条「外部 PNG」
 * 路径不会再被触发。
 *
 * 因此这里不再登记任何文件：一旦登记，`assetResolver.modelTextureUrl()` 在编辑器构建里
 * 会把对应 PNG 重新拉进 webpack 依赖图，库构建也会把它们拷进 `dist-lib/img/models/`，
 * 白白多出约 200 MB。
 *
 * 历史数据（材质 → `-n/-e/-s` 文件）仍保留在 `tests/unit/scripts/texture-mapping.json`，
 * 供 `scripts/glb-ktx2` 与清理脚本核对；确需回滚到「外部贴图」方案时从该 JSON 重新生成。
 */

/** 单个材质可用的外部通道贴图（解析后的 URL） */
export interface MaterialMapUrls {
    /** 法线图（切线空间，绿通道朝上） */
    readonly normal?: string;
    /** 自发光图 */
    readonly emissive?: string;
    /** Unity spec-gloss：RGB=高光色，A=光滑度 */
    readonly spec?: string;
}

/** 单个材质用到的贴图文件（`src/` 相对路径） */
export interface MaterialMapFiles {
    readonly normal?: string;
    readonly emissive?: string;
    readonly spec?: string;
}

/** 不再有任何材质依赖外部 PNG */
export const materialTextureFiles: Readonly<Record<string, MaterialMapFiles>> = {};

/** 渲染期查询表：恒为空，`hasMaterialTextures()` 因此永远返回 false */
export const materialMapUrls: Readonly<Record<string, MaterialMapUrls>> = {};

/** 供测试与清理脚本核对：恒为空 */
export const manifestTextureFiles: readonly string[] = [];
