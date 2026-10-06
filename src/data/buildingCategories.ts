export interface CategoryBuilding {
    itemId: number;
    modelIndex: number;
    nameKey: string;
    /** true = greyed out, placement not implemented in test phase */
    disabled?: boolean;
    /** true = 地基：选中进入地基模式（铺/涂一格），不做建筑放置 */
    foundation?: boolean;
}

export interface CategoryEntry {
    key: number; // 1-9
    nameKey: string; // i18n key
    buildings: CategoryBuilding[];
}

export const buildingCategories: CategoryEntry[] = [
    {
        key: 1,
        nameKey: "电力类",
        buildings: [
            { itemId: 2201, modelIndex: 44, nameKey: "电力感应塔" },
            { itemId: 2202, modelIndex: 71, nameKey: "无线输电塔" },
            { itemId: 2212, modelIndex: 68, nameKey: "卫星配电站" },
            { itemId: 2203, modelIndex: 53, nameKey: "风力涡轮机" },
            { itemId: 2204, modelIndex: 54, nameKey: "火力发电厂" },
            { itemId: 2205, modelIndex: 55, nameKey: "太阳能板" },
            { itemId: 2213, modelIndex: 255, nameKey: "地热发电站" },
            { itemId: 2211, modelIndex: 118, nameKey: "微型聚变发电站" },
            { itemId: 2207, modelIndex: 46, nameKey: "蓄电器（满）" },
        ],
    },
    {
        key: 2,
        nameKey: "矿产类",
        buildings: [
            { itemId: 2301, modelIndex: 57, nameKey: "采矿机" },
            { itemId: 2316, modelIndex: 256, nameKey: "大型采矿机" },
            { itemId: 2306, modelIndex: 60, nameKey: "抽水站" },
            { itemId: 2307, modelIndex: 61, nameKey: "原油萃取站" },
        ],
    },
    {
        key: 3,
        nameKey: "物流类",
        buildings: [
            { itemId: 2001, modelIndex: 35, nameKey: "低速传送带" },
            { itemId: 2002, modelIndex: 36, nameKey: "高速传送带" },
            { itemId: 2003, modelIndex: 37, nameKey: "极速传送带" },
            { itemId: 2011, modelIndex: 41, nameKey: "低速分拣器" },
            { itemId: 2012, modelIndex: 42, nameKey: "高速分拣器" },
            { itemId: 2013, modelIndex: 43, nameKey: "极速分拣器" },
            { itemId: 2014, modelIndex: 483, nameKey: "集装分拣器" },
            { itemId: 2020, modelIndex: 38, nameKey: "四向分流器" },
            { itemId: 2030, modelIndex: 208, nameKey: "流速器" },
            { itemId: 2313, modelIndex: 120, nameKey: "喷涂机" },
        ],
    },
    {
        key: 4,
        nameKey: "仓储类",
        buildings: [
            { itemId: 2101, modelIndex: 51, nameKey: "小型储物仓" },
            { itemId: 2102, modelIndex: 52, nameKey: "大型储物仓" },
            { itemId: 2106, modelIndex: 121, nameKey: "储液罐" },
        ],
    },
    {
        key: 5,
        nameKey: "生产类",
        buildings: [
            { itemId: 2302, modelIndex: 62, nameKey: "电弧熔炉" },
            { itemId: 2315, modelIndex: 194, nameKey: "位面熔炉" },
            { itemId: 2303, modelIndex: 65, nameKey: "制造台 Mk.I" },
            { itemId: 2304, modelIndex: 66, nameKey: "制造台 Mk.II" },
            { itemId: 2305, modelIndex: 67, nameKey: "制造台 Mk.III" },
            { itemId: 2308, modelIndex: 63, nameKey: "原油精炼厂" },
            { itemId: 2309, modelIndex: 64, nameKey: "化工厂" },
            { itemId: 2317, modelIndex: 376, nameKey: "化工厂 Mk.II" },
            { itemId: 2314, modelIndex: 119, nameKey: "分馏塔" },
            { itemId: 2310, modelIndex: 69, nameKey: "微型粒子对撞机" },
        ],
    },
    {
        key: 6,
        nameKey: "物流塔类",
        buildings: [
            { itemId: 2107, modelIndex: 371, nameKey: "物流配送器" },
            { itemId: 2040, modelIndex: 257, nameKey: "自动集装机" },
            { itemId: 2103, modelIndex: 49, nameKey: "物流运输站" },
            { itemId: 2104, modelIndex: 50, nameKey: "星际物流运输站" },
            { itemId: 2209, modelIndex: 45, nameKey: "能量枢纽" },
        ],
    },
    {
        key: 7,
        nameKey: "防御类",
        buildings: [
            { itemId: 3001, modelIndex: 374, nameKey: "高斯机枪塔" },
            { itemId: 3005, modelIndex: 407, nameKey: "导弹防御塔" },
            { itemId: 3003, modelIndex: 375, nameKey: "聚爆加农炮" },
            { itemId: 3002, modelIndex: 373, nameKey: "高频激光塔" },
            { itemId: 3004, modelIndex: 408, nameKey: "磁化电浆炮" },
            { itemId: 3009, modelIndex: 453, nameKey: "战场分析基站" },
            { itemId: 3010, modelIndex: 482, nameKey: "地面电浆炮" },
            { itemId: 3006, modelIndex: 422, nameKey: "干扰塔" },
            { itemId: 3008, modelIndex: 402, nameKey: "护盾发生器" },
        ],
    },
    {
        key: 8,
        nameKey: "戴森球类",
        buildings: [
            { itemId: 2901, modelIndex: 70, nameKey: "矩阵研究站" },
            { itemId: 2311, modelIndex: 72, nameKey: "电磁轨道弹射器" },
            { itemId: 2208, modelIndex: 73, nameKey: "射线接收站" },
            { itemId: 2312, modelIndex: 74, nameKey: "垂直发射井" },
            { itemId: 2210, modelIndex: 56, nameKey: "人造恒星" },
            { itemId: 2902, modelIndex: 455, nameKey: "矩阵研究站 Mk.II" },
            { itemId: 2319, modelIndex: 457, nameKey: "熔炉 Mk.III" },
            { itemId: 2318, modelIndex: 456, nameKey: "制造台 Mk.IV" },
        ],
    },
    {
        key: 9,
        nameKey: "地基与信标",
        buildings: [
            { itemId: 2401, modelIndex: 664, nameKey: "全息信标" },
            { itemId: 1131, modelIndex: 0, nameKey: "地基", foundation: true },
        ],
    },
];
