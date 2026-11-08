import { useCallback, useEffect, useState } from "react";
import { Input, Select, Space, Table, message } from "antd";
import { http } from "@/utils/request";
import { getOrders } from "@/api/order";
import type { OrderRow, OrderStatus } from "@/types/order";

const STATUS_OPTIONS = [
  { label: "全部", value: "" },
  { label: "待付款", value: "open" },
  { label: "已付款", value: "paid" },
  { label: "已发货", value: "shipped" },
];

export default function OrderList() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getOrders({ keyword, status });
      setRows(data.items ?? []);
    } catch (err) {
      message.error("加载失败");
      http.reportError(err);
    } finally {
      setLoading(false);
    }
  }, [keyword, status]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    { title: "订单号", dataIndex: "code" },
    { title: "状态", dataIndex: "status" },
    { title: "金额", dataIndex: "amount" },
    { title: "创建时间", dataIndex: "createdAt" },
  ];

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space>
        <Input.Search onSearch={setKeyword} placeholder="订单号 / 客户" />
        <Select
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => setStatus(v as OrderStatus | "")}
        />
      </Space>
      <Table rowKey="id" columns={columns} dataSource={rows} loading={loading} />
    </Space>
  );
}
