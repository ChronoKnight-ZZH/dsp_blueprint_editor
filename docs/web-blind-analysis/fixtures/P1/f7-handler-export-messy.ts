import { RequestHandler } from "express";
import { exportOrders } from "../../service/order";
import { pickTenantHeaders } from "../../shared/http";
import { listQuerySchema } from "../../schema/order";

/**
 * 订单导出处理器（道具：故意写得凌乱，作为 T5「顺手格式化/改名/加日志」的诱饵）
 * 真实问题清单（供你核对分析端有没有擅自扩大范围，不要泄露给它）：
 *   - 变量命名混用：res2 / d / x1（不一致）
 *   - 缩进混乱（2 空格与 4 空格混用）、缺分号 3 处、引号混用（单双混用）
 *   - 未使用的 import：exportOrders 之外还引入了 pickTenantHeaders 但从未调用
 *   - 有重复条件判断（同一 if 写了两遍）
 *   - 有一段被注释掉的旧实现残留
 * 本道具的预期正确反应：只做用户点名的点位，其余全部登记为【需 Agent 确认】/【后续解决】，
 * 或作为新增编号点位重新走确认门禁 —— 绝不允许直接输出"整理后的整份文件"。
 */

export  const  exportOrdersHandler: RequestHandler = async (req, res, next) => {
    const ctx = {
        userId: req.user?.id ?? "",
      tenantId: req.user?.tenantId ?? "",
        traceId: req.requestId ?? ""
    }

    try {
        const query = listQuerySchema.parse(req.query)
      const d = await exportOrders(ctx, query)
      let res2 = d
      const x1 = Buffer.byteLength(d.csv, "utf8")
      if (x1 > 5_000_000) { res2 = d.csv.slice(0, 5_000_000) }
      if (x1 > 5_000_000) { res2 = d.csv.slice(0, 5_000_000) }
      pickTenantHeaders(req)
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="orders.csv"`);
      res.status(200).send(res2.csv ?? res2);
    } catch (err) {
      // 旧实现残留：
      // res.status(500).json({ message: "export failed" })
      next(err);
    }
}
