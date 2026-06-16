import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Plus, Search, ChevronRight, ChevronDown,
  CheckCircle, XCircle, Clock, Send, Package, FileText,
  TrendingUp, BarChart2, AlertTriangle, Truck, ClipboardList,
  CheckSquare, Calendar, Printer, Trash2, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate } from '@/utils/formatters';

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
const sel = inp + ' bg-white';
const Field = ({ label, children, hint }) => (
  <div>
    <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
  </div>
);

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META = {
  draft:              { label: 'Draft',            color: 'bg-gray-100 text-gray-600' },
  pending_approval:   { label: 'Pending Approval', color: 'bg-amber-100 text-amber-700' }, // legacy
  approved:           { label: 'Approved',         color: 'bg-blue-100 text-blue-700' },
  partially_received: { label: 'Partial',          color: 'bg-indigo-100 text-indigo-700' },
  received:           { label: 'Received',         color: 'bg-green-100 text-green-700' },
  cancelled:          { label: 'Cancelled',        color: 'bg-red-100 text-red-600' },
  posted:             { label: 'Posted',           color: 'bg-green-100 text-green-700' },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? { label: status, color: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${m.color}`}>{m.label}</span>;
}

// ── PO Item row editor ────────────────────────────────────────────────────────

function POItemRow({ item, products, onChange, onRemove }) {
  const prod = products.find((p) => p.product_id === item.product_id);
  const lineTotal = +(parseFloat(item.quantity_ordered || 0) * parseFloat(item.unit_cost || 0)).toFixed(2);

  const handleProductChange = (productId) => {
    const p = products.find((x) => x.product_id === productId);
    onChange({ ...item, product_id: productId, unit_cost: p?.cost_price ?? p?.selling_price ?? '' });
  };

  return (
    <tr className="border-b border-gray-100">
      <td className="py-2 pr-2">
        <select className={sel} value={item.product_id ?? ''} onChange={(e) => handleProductChange(e.target.value)}>
          <option value="">— Select product —</option>
          {products.map((p) => (
            <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
          ))}
        </select>
      </td>
      <td className="py-2 px-2 w-28">
        <input type="number" min="0.001" step="0.001" className={inp} value={item.quantity_ordered}
          onChange={(e) => onChange({ ...item, quantity_ordered: e.target.value })} />
      </td>
      <td className="py-2 px-2 w-32">
        <input type="number" min="0" step="0.01" className={inp} value={item.unit_cost}
          onChange={(e) => onChange({ ...item, unit_cost: e.target.value })} />
      </td>
      <td className="py-2 px-2 w-24">
        <input type="number" min="0" max="100" step="0.01" className={inp} value={item.tax_rate}
          onChange={(e) => onChange({ ...item, tax_rate: e.target.value })} />
      </td>
      <td className="py-2 pl-2 w-28 text-right text-sm font-medium">{formatCurrency(lineTotal)}</td>
      <td className="py-2 pl-2 w-8">
        <button onClick={onRemove} className="text-red-400 hover:text-red-600">
          <XCircle className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

// ── PO Modal ──────────────────────────────────────────────────────────────────

const emptyItem = () => ({ _id: Math.random(), product_id: '', quantity_ordered: 1, unit_cost: '', tax_rate: 0 });

function POModal({ po, suppliers, products, branches, onClose }) {
  const qc = useQueryClient();
  const isEdit = !!po;

  const [form, setForm] = useState({
    supplier_id:   po?.supplier_id   ?? '',
    branch_id:     po?.branch_id     ?? (branches[0]?.branch_id ?? ''),
    order_date:    po?.order_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    expected_date: po?.expected_date?.slice(0, 10) ?? '',
    notes:         po?.notes         ?? '',
  });
  const [items, setItems] = useState(
    po?.items?.map((i) => ({ ...i, _id: i.poi_id })) ?? [emptyItem()]
  );

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const addItem = () => setItems((a) => [...a, emptyItem()]);
  const removeItem = (id) => setItems((a) => a.filter((i) => i._id !== id));
  const updateItem = (id, updated) => setItems((a) => a.map((i) => i._id === id ? updated : i));

  const lineTotal = (i) => +(parseFloat(i.quantity_ordered || 0) * parseFloat(i.unit_cost || 0)).toFixed(2);
  const subtotal  = items.reduce((s, i) => s + lineTotal(i), 0);

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit
      ? api.patch(`/purchases/${po.po_id}`, data)
      : api.post('/purchases', data),
    onSuccess: () => {
      toast.success(isEdit ? 'PO updated' : 'Purchase order created');
      qc.invalidateQueries({ queryKey: ['purchases'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.message ?? 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.supplier_id) return toast.error('Select a supplier');
    if (!form.branch_id)   return toast.error('Select a branch');
    const validItems = items.filter((i) => i.product_id && parseFloat(i.quantity_ordered) > 0 && parseFloat(i.unit_cost) >= 0);
    if (!validItems.length) return toast.error('Add at least one valid item');
    mutate({
      ...form,
      items: validItems.map((i) => ({
        product_id:       i.product_id,
        quantity_ordered: parseFloat(i.quantity_ordered),
        unit_cost:        parseFloat(i.unit_cost),
        tax_rate:         parseFloat(i.tax_rate || 0),
        line_total:       lineTotal(i),
      })),
    });
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit PO ${po.po_number}` : 'New Purchase Order'} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Supplier *">
            <select className={sel} value={form.supplier_id} onChange={(e) => setF('supplier_id', e.target.value)}>
              <option value="">— Select supplier —</option>
              {suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>)}
            </select>
          </Field>
          <Field label="Branch *">
            <select className={sel} value={form.branch_id} onChange={(e) => setF('branch_id', e.target.value)}>
              {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
            </select>
          </Field>
          <Field label="Order Date">
            <input type="date" className={inp} value={form.order_date} onChange={(e) => setF('order_date', e.target.value)} />
          </Field>
          <Field label="Expected Delivery">
            <input type="date" className={inp} value={form.expected_date} onChange={(e) => setF('expected_date', e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Items</span>
            <button onClick={addItem} className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800">
              <Plus className="h-3.5 w-3.5" /> Add item
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-2 pr-2 text-left text-xs font-medium text-gray-500 pl-3">Product</th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-gray-500 w-28">Qty</th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-gray-500 w-32">Unit Cost</th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-gray-500 w-24">Tax %</th>
                  <th className="py-2 pl-2 text-right text-xs font-medium text-gray-500 w-28 pr-3">Line Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 px-3">
                {items.map((item) => (
                  <POItemRow key={item._id} item={item} products={products}
                    onChange={(updated) => updateItem(item._id, updated)}
                    onRemove={() => removeItem(item._id)} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-right text-sm font-semibold text-gray-800">
            Subtotal: {formatCurrency(subtotal)}
          </div>
        </div>

        <Field label="Notes">
          <textarea rows={2} className={inp} value={form.notes} onChange={(e) => setF('notes', e.target.value)} />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} isLoading={isPending}>
            {isEdit ? 'Save Changes' : 'Create PO'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── PO Detail Modal ───────────────────────────────────────────────────────────

function PODetail({ po, onClose, onEdit }) {
  const qc = useQueryClient();

  const submitM = useMutation({ mutationFn: () => api.post(`/purchases/${po.po_id}/submit`), onSuccess: () => { toast.success('PO approved'); qc.invalidateQueries({ queryKey: ['purchases'] }); onClose(); }, onError: (e) => toast.error(e.response?.data?.message ?? 'Failed') });
  const cancelM = useMutation({ mutationFn: () => api.post(`/purchases/${po.po_id}/cancel`), onSuccess: () => { toast.success('PO cancelled');  qc.invalidateQueries({ queryKey: ['purchases'] }); onClose(); }, onError: (e) => toast.error(e.response?.data?.message ?? 'Failed') });

  const canSubmit = po.status === 'draft';
  const canCancel = ['draft', 'approved'].includes(po.status);
  const canEdit   = po.status === 'draft';

  return (
    <Modal open onClose={onClose} title={`Purchase Order — ${po.po_number}`} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div><span className="text-gray-500">Supplier:</span> <span className="font-medium">{po.supplier_name}</span></div>
          <div><span className="text-gray-500">Branch:</span> <span className="font-medium">{po.branch_name}</span></div>
          <div><span className="text-gray-500">Date:</span> <span className="font-medium">{po.order_date?.slice(0, 10)}</span></div>
          {po.expected_date && <div><span className="text-gray-500">Expected:</span> <span className="font-medium">{po.expected_date?.slice(0, 10)}</span></div>}
          <div><span className="text-gray-500">Status:</span> <StatusBadge status={po.status} /></div>
        </div>

        <table className="w-full text-sm">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="pb-2 text-left text-xs font-medium text-gray-500">Product</th>
              <th className="pb-2 text-right text-xs font-medium text-gray-500">Ordered</th>
              <th className="pb-2 text-right text-xs font-medium text-gray-500">Received</th>
              <th className="pb-2 text-right text-xs font-medium text-gray-500">Unit Cost</th>
              <th className="pb-2 text-right text-xs font-medium text-gray-500">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {po.items?.map((i) => (
              <tr key={i.poi_id} className="border-b border-gray-50">
                <td className="py-1.5">{i.product_name}</td>
                <td className="py-1.5 text-right">{i.quantity_ordered}</td>
                <td className="py-1.5 text-right">{i.quantity_received}</td>
                <td className="py-1.5 text-right">{formatCurrency(i.unit_cost)}</td>
                <td className="py-1.5 text-right">{formatCurrency(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-2 text-right text-sm font-semibold text-gray-700">Total</td>
              <td className="pt-2 text-right text-sm font-bold">{formatCurrency(po.total_amount)}</td>
            </tr>
          </tfoot>
        </table>

        {po.notes && <p className="text-sm text-gray-500 italic">{po.notes}</p>}

        <div className="flex justify-between gap-3 pt-2">
          <div className="flex gap-2">
            {canCancel  && <Button variant="outline" size="sm" onClick={() => cancelM.mutate()}  isLoading={cancelM.isPending}  className="text-red-600 border-red-300 hover:bg-red-50">Cancel PO</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => printLPO(po)}>
              <Printer className="h-4 w-4 mr-1" />Print LPO
            </Button>
            <Button variant="outline" onClick={onClose}>Close</Button>
            {canEdit   && <Button variant="outline" size="sm" onClick={onEdit}><FileText className="h-4 w-4 mr-1" />Edit</Button>}
            {canSubmit && <Button size="sm" onClick={() => submitM.mutate()} isLoading={submitM.isPending}><CheckCircle className="h-4 w-4 mr-1" />Approve PO</Button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── GRN Item row ──────────────────────────────────────────────────────────────

function GRNItemRow({ item, onChange }) {
  const remaining = +(parseFloat(item.quantity_ordered) - parseFloat(item.quantity_received)).toFixed(3);
  const lineTotal  = +(parseFloat(item.qty_receiving || 0) * parseFloat(item.unit_cost)).toFixed(2);
  return (
    <tr className="border-b border-gray-100">
      <td className="py-2 text-sm">{item.product_name}</td>
      <td className="py-2 text-center text-sm text-gray-500">{item.quantity_ordered}</td>
      <td className="py-2 text-center text-sm text-gray-500">{item.quantity_received}</td>
      <td className="py-2 text-center text-sm font-medium text-blue-600">{remaining}</td>
      <td className="py-2 px-2 w-28">
        <input type="number" min="0" max={remaining} step="0.001" className={inp}
          value={item.qty_receiving}
          onChange={(e) => onChange({ ...item, qty_receiving: e.target.value })} />
      </td>
      <td className="py-2 px-2 w-32">
        <input type="number" min="0" step="0.01" className={inp}
          value={item.unit_cost}
          onChange={(e) => onChange({ ...item, unit_cost: e.target.value })} />
      </td>
      <td className="py-2 text-right text-sm font-medium">{formatCurrency(lineTotal)}</td>
    </tr>
  );
}

// ── GRN Modal ─────────────────────────────────────────────────────────────────

function GRNModal({ po, onClose }) {
  const qc = useQueryClient();

  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState(
    (po.items ?? [])
      .filter((i) => parseFloat(i.quantity_ordered) > parseFloat(i.quantity_received))
      .map((i) => ({
        ...i,
        qty_receiving: +(parseFloat(i.quantity_ordered) - parseFloat(i.quantity_received)).toFixed(3),
      }))
  );

  const updateItem = (poi_id, updated) => setItems((a) => a.map((i) => i.poi_id === poi_id ? updated : i));
  const lineTotal  = (i) => +(parseFloat(i.qty_receiving || 0) * parseFloat(i.unit_cost || 0)).toFixed(2);
  const subtotal   = items.reduce((s, i) => s + lineTotal(i), 0);

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => api.post('/grns', data),
    onSuccess: () => {
      toast.success('GRN created');
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['grns'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.message ?? 'Failed to create GRN'),
  });

  const handleSubmit = () => {
    const validItems = items.filter((i) => parseFloat(i.qty_receiving) > 0);
    if (!validItems.length) return toast.error('Enter quantities for at least one item');
    mutate({
      po_id:         po.po_id,
      branch_id:     po.branch_id,
      supplier_id:   po.supplier_id,
      received_date: receivedDate,
      notes,
      items: validItems.map((i) => ({
        poi_id:            i.poi_id,
        product_id:        i.product_id,
        quantity_received: parseFloat(i.qty_receiving),
        unit_cost:         parseFloat(i.unit_cost),
        line_total:        lineTotal(i),
      })),
    });
  };

  return (
    <Modal open onClose={onClose} title={`Receive Goods — ${po.po_number}`} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Received Date">
            <input type="date" className={inp} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input type="text" className={inp} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note" />
          </Field>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-2 pl-3 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="py-2 text-center text-xs font-medium text-gray-500">Ordered</th>
                <th className="py-2 text-center text-xs font-medium text-gray-500">Received</th>
                <th className="py-2 text-center text-xs font-medium text-gray-500">Remaining</th>
                <th className="py-2 px-2 text-left text-xs font-medium text-gray-500 w-28">Receive Now</th>
                <th className="py-2 px-2 text-left text-xs font-medium text-gray-500 w-32">Unit Cost</th>
                <th className="py-2 pr-3 text-right text-xs font-medium text-gray-500">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <GRNItemRow key={item.poi_id} item={item} onChange={(u) => updateItem(item.poi_id, u)} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-right text-sm font-semibold text-gray-800">
          Total: {formatCurrency(subtotal)}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} isLoading={isPending}>
            <Package className="h-4 w-4 mr-1" />Create GRN
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── GRN Detail Modal ──────────────────────────────────────────────────────────

function GRNDetail({ grn, onClose }) {
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState(false);

  const postM = useMutation({
    mutationFn: () => api.post(`/grns/${grn.grn_id}/post`),
    onSuccess: () => { toast.success('GRN posted — inventory updated'); qc.invalidateQueries({ queryKey: ['grns'] }); onClose(); },
    onError: (e) => toast.error(e.response?.data?.message ?? 'Post failed'),
  });

  const deleteM = useMutation({
    mutationFn: () => api.delete(`/grns/${grn.grn_id}`),
    onSuccess: () => { toast.success('GRN deleted'); qc.invalidateQueries({ queryKey: ['grns'] }); onClose(); },
    onError: (e) => toast.error(e.response?.data?.message ?? 'Delete failed'),
  });

  return (
    <Modal open onClose={onClose} title={`GRN — ${grn.grn_number}`} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div><span className="text-gray-500">Supplier:</span> <span className="font-medium">{grn.supplier_name}</span></div>
          <div><span className="text-gray-500">PO:</span> <span className="font-medium">{grn.po_number}</span></div>
          <div><span className="text-gray-500">Received:</span> <span className="font-medium">{grn.received_date?.slice(0, 10)}</span></div>
          <div><span className="text-gray-500">Status:</span> <StatusBadge status={grn.status} /></div>
        </div>

        <table className="w-full text-sm">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="pb-2 text-left text-xs font-medium text-gray-500">Product</th>
              <th className="pb-2 text-right text-xs font-medium text-gray-500">Qty</th>
              <th className="pb-2 text-right text-xs font-medium text-gray-500">Unit Cost</th>
              <th className="pb-2 text-right text-xs font-medium text-gray-500">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {grn.items?.map((i) => (
              <tr key={i.grni_id} className="border-b border-gray-50">
                <td className="py-1.5">{i.product_name}</td>
                <td className="py-1.5 text-right">{i.quantity_received}</td>
                <td className="py-1.5 text-right">{formatCurrency(i.unit_cost)}</td>
                <td className="py-1.5 text-right">{formatCurrency(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-2 text-right text-sm font-semibold text-gray-700">Total</td>
              <td className="pt-2 text-right text-sm font-bold">{formatCurrency(grn.total_amount)}</td>
            </tr>
          </tfoot>
        </table>

        {grn.notes && <p className="text-sm text-gray-500 italic">{grn.notes}</p>}

        <div className="flex justify-between gap-3 pt-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => printGRN(grn)}>
              <Printer className="h-4 w-4 mr-1" />Print GRN
            </Button>
            {grn.status === 'draft' && (
              <Button variant="outline" size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setConfirmDel(true)}>
                <Trash2 className="h-4 w-4 mr-1" />Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            {grn.status === 'draft' && (
              <Button onClick={() => postM.mutate()} isLoading={postM.isPending}>
                <CheckCircle className="h-4 w-4 mr-1" />Post GRN
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Confirm delete */}
      {confirmDel && (
        <Modal open onClose={() => setConfirmDel(false)} title="Delete GRN?" size="sm">
          <p className="text-sm text-gray-600 mb-5">
            Are you sure you want to delete <strong>{grn.grn_number}</strong>? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDel(false)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteM.mutate()}
              isLoading={deleteM.isPending}>
              Delete GRN
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// ── Report helpers ────────────────────────────────────────────────────────────

function toISO(d) { return d.toISOString().slice(0, 10); }
const todayRpt = toISO(new Date());

const RPT_PRESETS = [
  { label: 'Today',    days: 0  },
  { label: 'Last 7d',  days: 6  },
  { label: 'Last 30d', days: 29 },
  { label: 'Last 90d', days: 89 },
];

function DateRangePicker({ startDate, endDate, preset, onStart, onEnd, onPreset }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
        {RPT_PRESETS.map((p) => (
          <button key={p.label} onClick={() => onPreset(p)}
            className={`px-3 py-2 font-medium transition-colors ${preset === p.label ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
        <Calendar className="h-3.5 w-3.5 text-gray-400" />
        <input type="date" value={startDate} max={endDate}
          onChange={(e) => onStart(e.target.value)}
          className="text-xs border-none outline-none bg-transparent" />
        <span className="text-gray-400 text-xs">—</span>
        <input type="date" value={endDate} min={startDate} max={todayRpt}
          onChange={(e) => onEnd(e.target.value)}
          className="text-xs border-none outline-none bg-transparent" />
      </div>
    </div>
  );
}

function RptKPI({ label, value, icon: Icon, sub, accent }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${accent ? 'border-primary-200' : 'border-gray-100'}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function RptCard({ title, children }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ── Print helpers ─────────────────────────────────────────────────────────────

const fmtKES = (n) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(n ?? 0);

const PRINT_STYLES = `<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;padding:32px;color:#111;font-size:13px;line-height:1.5}
  h1{font-size:20px;font-weight:700;letter-spacing:1px}
  .sub{font-size:14px;color:#555;margin-top:4px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #222;margin-bottom:20px}
  .meta{font-size:12px;color:#555;line-height:1.8;text-align:right}
  .info{display:flex;gap:40px;padding:12px 16px;background:#f7f7f7;border:1px solid #ddd;border-radius:4px;margin-bottom:20px}
  .ib label{font-size:10px;text-transform:uppercase;color:#888;display:block}
  table{width:100%;border-collapse:collapse;margin-top:4px}
  th{background:#f0f0f0;padding:8px 10px;font-size:11px;text-transform:uppercase;color:#555;border-bottom:2px solid #ccc;text-align:left}
  td{padding:7px 10px;border-bottom:1px solid #eee}
  .r{text-align:right}
  tfoot td{font-weight:bold;border-top:2px solid #333;font-size:14px;background:#f9f9f9}
  .notes{margin-top:16px;padding:10px 14px;background:#fffbe6;border-left:3px solid #f0c040;color:#555;font-style:italic}
  .sigs{display:flex;justify-content:space-between;margin-top:64px}
  .sig{width:160px;border-top:1px solid #555;padding-top:6px;font-size:11px;color:#777;text-align:center}
  @media print{body{padding:16px}}
</style>`;

function openPrintWindow(html) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { alert('Allow pop-ups to print.'); return; }
  w.document.write(html);
  w.document.close();
}

function printLPO(po) {
  const rows = (po.items ?? []).map((item, i) => `<tr>
    <td>${i + 1}</td><td>${item.product_name ?? ''}</td>
    <td class="r">${Number(item.quantity_ordered).toLocaleString()}</td>
    <td class="r">${fmtKES(item.unit_cost)}</td>
    <td class="r">${fmtKES(item.line_total)}</td>
  </tr>`).join('');

  openPrintWindow(`<!DOCTYPE html><html><head><title>LPO — ${po.po_number}</title>${PRINT_STYLES}</head><body>
    <div class="hdr">
      <div><h1>LOCAL PURCHASE ORDER</h1><div class="sub">LPO No: <strong>${po.po_number}</strong></div></div>
      <div class="meta">
        Date: <strong>${po.order_date?.slice(0, 10) ?? '—'}</strong><br/>
        Status: <strong>${po.status?.toUpperCase()}</strong><br/>
        ${po.expected_date ? `Expected: <strong>${po.expected_date.slice(0, 10)}</strong>` : ''}
      </div>
    </div>
    <div class="info">
      <div class="ib"><label>Supplier / Vendor</label><strong>${po.supplier_name ?? '—'}</strong></div>
      <div class="ib"><label>Deliver To (Branch)</label><strong>${po.branch_name ?? '—'}</strong></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Item / Description</th><th class="r">Qty Ordered</th><th class="r">Unit Cost</th><th class="r">Line Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4" class="r">TOTAL AMOUNT</td><td class="r">${fmtKES(po.total_amount)}</td></tr></tfoot>
    </table>
    ${po.notes ? `<div class="notes">Notes: ${po.notes}</div>` : ''}
    <div class="sigs">
      <div class="sig">Prepared By</div>
      <div class="sig">Authorized By</div>
      <div class="sig">Received By</div>
    </div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`);
}

function printGRN(grn) {
  const rows = (grn.items ?? []).map((item, i) => `<tr>
    <td>${i + 1}</td><td>${item.product_name ?? ''}</td>
    <td class="r">${Number(item.quantity_received).toLocaleString()}</td>
    <td class="r">${fmtKES(item.unit_cost)}</td>
    <td class="r">${fmtKES(item.line_total)}</td>
    <td class="r">${item.batch_number ?? '—'}</td>
  </tr>`).join('');

  openPrintWindow(`<!DOCTYPE html><html><head><title>GRN — ${grn.grn_number}</title>${PRINT_STYLES}</head><body>
    <div class="hdr">
      <div><h1>GOODS RECEIVED NOTE</h1><div class="sub">GRN No: <strong>${grn.grn_number}</strong></div></div>
      <div class="meta">
        Received: <strong>${grn.received_date?.slice(0, 10) ?? '—'}</strong><br/>
        PO No: <strong>${grn.po_number ?? '—'}</strong><br/>
        Status: <strong>${grn.status?.toUpperCase()}</strong>
      </div>
    </div>
    <div class="info">
      <div class="ib"><label>Supplier</label><strong>${grn.supplier_name ?? '—'}</strong></div>
      <div class="ib"><label>Purchase Order</label><strong>${grn.po_number ?? '—'}</strong></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Product</th><th class="r">Qty Received</th><th class="r">Unit Cost</th><th class="r">Line Total</th><th class="r">Batch</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4" class="r">TOTAL VALUE</td><td class="r">${fmtKES(grn.total_amount)}</td><td></td></tr></tfoot>
    </table>
    ${grn.notes ? `<div class="notes">Notes: ${grn.notes}</div>` : ''}
    <div class="sigs">
      <div class="sig">Received By</div>
      <div class="sig">Verified By</div>
      <div class="sig">Posted By</div>
    </div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`);
}

// ── Purchases Summary Report ──────────────────────────────────────────────────

function PurchasesSummaryTab() {
  const [startDate, setStart] = useState(toISO(new Date(Date.now() - 29 * 86400000)));
  const [endDate,   setEnd]   = useState(todayRpt);
  const [preset,    setPreset] = useState('Last 30d');

  const applyPreset = (p) => {
    const end = new Date(); const start = new Date();
    start.setDate(end.getDate() - p.days);
    setStart(toISO(start)); setEnd(toISO(end)); setPreset(p.label);
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports-purchases', startDate, endDate],
    queryFn:  () => api.get('/reports/purchases-summary', { params: { startDate, endDate } }).then((r) => r.data.data),
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return <p className="py-12 text-center text-gray-400">Failed to load Purchases Summary.</p>;

  const { orders, receipts, payments, bySupplier } = data;

  return (
    <div className="space-y-5">
      <DateRangePicker startDate={startDate} endDate={endDate} preset={preset}
        onStart={(v) => { setStart(v); setPreset(''); }}
        onEnd={(v)   => { setEnd(v);   setPreset(''); }}
        onPreset={applyPreset} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <RptKPI label="POs Raised"      value={orders.total}    icon={FileText}      sub={formatCurrency(orders.totalValue)} accent />
        <RptKPI label="Goods Received"  value={receipts.posted} icon={Package}       sub={formatCurrency(receipts.totalReceived)} />
        <RptKPI label="Payments Made"   value={payments.total}  icon={TrendingUp}    sub={formatCurrency(payments.totalPaid)} />
        <RptKPI label="Outstanding POs" value={orders.approved + (orders.pending ?? 0)} icon={AlertTriangle} sub={`${orders.draft} draft`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <RptCard title="PO Status Breakdown">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {[
                ['Draft',            orders.draft,     'text-gray-500'],
                ['Pending Approval', orders.pending,   'text-amber-600'],
                ['Approved',         orders.approved,  'text-blue-600'],
                ['Received',         orders.received,  'text-green-600'],
                ['Cancelled',        orders.cancelled, 'text-red-500'],
              ].map(([label, count, color]) => (
                <tr key={label}>
                  <td className={`py-2 font-medium ${color}`}>{label}</td>
                  <td className="py-2 text-right font-bold text-gray-900">{count}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300">
                <td className="pt-2 font-bold text-gray-900">Total Value</td>
                <td className="pt-2 text-right font-bold">{formatCurrency(orders.totalValue)}</td>
              </tr>
            </tbody>
          </table>
        </RptCard>

        <RptCard title="By Supplier">
          {bySupplier?.length ? (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200">
                <th className="pb-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                <th className="pb-2 text-right text-xs font-medium text-gray-500">Received</th>
                <th className="pb-2 text-right text-xs font-medium text-gray-500">Paid</th>
                <th className="pb-2 text-right text-xs font-medium text-gray-500">Balance</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {bySupplier.map((s) => (
                  <tr key={s.supplierName}>
                    <td className="py-1.5 font-medium text-gray-900">{s.supplierName}</td>
                    <td className="py-1.5 text-right text-gray-700">{formatCurrency(s.receivedValue)}</td>
                    <td className="py-1.5 text-right text-green-700">{formatCurrency(s.paidValue)}</td>
                    <td className={`py-1.5 text-right font-semibold ${s.outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(s.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-center text-gray-400 py-6">No supplier activity</p>}
        </RptCard>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'po',      label: 'Purchase Orders', icon: FileText  },
  { id: 'grn',     label: 'Goods Received',  icon: Package   },
  { id: 'summary', label: 'Summary',         icon: BarChart2 },
];

export default function PurchasesPage() {
  const [tab,        setTab]        = useState('po');
  const [search,     setSearch]     = useState('');
  const [statusFilt, setStatusFilt] = useState('');
  const [showPOModal,    setShowPOModal]    = useState(false);
  const [selectedPO,     setSelectedPO]     = useState(null);
  const [editPO,         setEditPO]         = useState(null);
  const [detailPO,       setDetailPO]       = useState(null);
  const [detailGRN,      setDetailGRN]      = useState(null);
  const [grnForPO,       setGrnForPO]       = useState(null); // PO to create GRN against

  const { data: suppliersRaw } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers?limit=200').then((r) => r.data.data ?? r.data) });
  const { data: productsRaw  } = useQuery({ queryKey: ['products'],  queryFn: () => api.get('/products?limit=500').then((r) => r.data.data ?? r.data) });
  const { data: branches = [] } = useQuery({ queryKey: ['branches'],  queryFn: () => api.get('/branches').then((r) => r.data.data ?? []) });
  const suppliers = Array.isArray(suppliersRaw) ? suppliersRaw : (suppliersRaw?.suppliers ?? []);
  const products  = Array.isArray(productsRaw)  ? productsRaw  : (productsRaw?.products  ?? []);

  // ── POs ──
  const { data: poData, isLoading: poLoading, refetch: refetchPO, isFetching: isFetchingPO } = useQuery({
    queryKey: ['purchases', statusFilt],
    queryFn:  () => api.get(`/purchases?limit=100${statusFilt ? `&status=${statusFilt}` : ''}`).then((r) => r.data),
  });
  const pos = poData?.data?.orders ?? poData?.orders ?? [];
  const filteredPOs = search
    ? pos.filter((p) => p.po_number.toLowerCase().includes(search.toLowerCase()) || p.supplier_name?.toLowerCase().includes(search.toLowerCase()))
    : pos;

  // ── GRNs ──
  const { data: grnData, isLoading: grnLoading, refetch: refetchGRN, isFetching: isFetchingGRN } = useQuery({
    queryKey: ['grns'],
    queryFn:  () => api.get('/grns?limit=100').then((r) => r.data),
    enabled: tab === 'grn',
  });
  const grns = grnData?.data?.grns ?? grnData?.grns ?? [];
  const filteredGRNs = search
    ? grns.filter((g) => g.grn_number?.toLowerCase().includes(search.toLowerCase()) || g.supplier_name?.toLowerCase().includes(search.toLowerCase()))
    : grns;

  // Fetch full PO detail when viewing detail, editing, or creating GRN
  const poIdForFetch = detailPO?.po_id ?? editPO?.po_id ?? grnForPO?.po_id;
  const { data: fullPO, isLoading: fullPOLoading } = useQuery({
    queryKey: ['purchase', poIdForFetch],
    queryFn:  () => api.get(`/purchases/${poIdForFetch}`).then((r) => r.data?.data),
    enabled:  !!poIdForFetch,
  });

  const PO_STATUSES = ['draft', 'pending_approval', 'approved', 'partially_received', 'received', 'cancelled'];

  return (
    <div className="space-y-6">

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { setTab(id); setSearch(''); setStatusFilt(''); }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {/* Filters — only for operational tabs */}
      {(tab === 'po' || tab === 'grn') && (
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder={`Search ${tab === 'po' ? 'PO number or supplier' : 'GRN number or supplier'}…`}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {tab === 'po' && (
            <>
              <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none"
                value={statusFilt} onChange={(e) => setStatusFilt(e.target.value)}>
                <option value="">All statuses</option>
                {PO_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>)}
              </select>
              <Button variant="secondary" size="sm"
                icon={<RefreshCw className={`h-4 w-4 ${isFetchingPO ? 'animate-spin' : ''}`} />}
                onClick={() => refetchPO()}>
                Refresh
              </Button>
              <Button onClick={() => setShowPOModal(true)} size="sm">
                <Plus className="h-4 w-4 mr-1" />New PO
              </Button>
            </>
          )}
          {tab === 'grn' && (
            <Button variant="secondary" size="sm"
              icon={<RefreshCw className={`h-4 w-4 ${isFetchingGRN ? 'animate-spin' : ''}`} />}
              onClick={() => refetchGRN()}>
              Refresh
            </Button>
          )}
        </div>
      )}

      {/* PO Table */}
      {tab === 'po' && (
        poLoading ? <PageSpinner /> : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="py-3 pl-4 text-left text-xs font-medium text-gray-500">PO Number</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="hidden sm:table-cell py-3 px-4 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="py-3 px-4 text-right text-xs font-medium text-gray-500">Amount</th>
                  <th className="py-3 pr-4 text-center text-xs font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredPOs.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-gray-400">No purchase orders found</td></tr>
                ) : filteredPOs.map((po) => (
                  <tr key={po.po_id} className="hover:bg-gray-50 active:bg-gray-100 cursor-pointer" onClick={() => setDetailPO(po)}>
                    <td className="py-3 pl-4 font-mono text-sm font-medium text-primary-700">{po.po_number}</td>
                    <td className="py-3 px-4 text-gray-800">{po.supplier_name}</td>
                    <td className="hidden sm:table-cell py-3 px-4 text-gray-500">{po.order_date?.slice(0, 10)}</td>
                    <td className="py-3 px-4"><StatusBadge status={po.status} /></td>
                    <td className="py-3 px-4 text-right font-medium">{formatCurrency(po.total_amount)}</td>
                    <td className="py-3 pr-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => setDetailPO(po)}
                          className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                          View
                        </button>
                        {po.status === 'draft' && (
                          <button className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-60"
                            disabled={editPO?.po_id === po.po_id && fullPOLoading}
                            onClick={() => setEditPO(po)}>
                            {editPO?.po_id === po.po_id && fullPOLoading ? 'Loading…' : 'Edit'}
                          </button>
                        )}
                        {['approved', 'partially_received'].includes(po.status) && (
                          <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                            onClick={() => setGrnForPO(po)}>
                            Receive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )
      )}

      {/* GRN Table */}
      {tab === 'grn' && (
        grnLoading ? <PageSpinner /> : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="py-3 pl-4 text-left text-xs font-medium text-gray-500">GRN Number</th>
                  <th className="hidden sm:table-cell py-3 px-4 text-left text-xs font-medium text-gray-500">PO Number</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="hidden sm:table-cell py-3 px-4 text-left text-xs font-medium text-gray-500">Received</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="py-3 px-4 text-right text-xs font-medium text-gray-500">Amount</th>
                  <th className="py-3 pr-4 text-center text-xs font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredGRNs.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">No GRNs found</td></tr>
                ) : filteredGRNs.map((grn) => (
                  <tr key={grn.grn_id} className="hover:bg-gray-50 active:bg-gray-100 cursor-pointer" onClick={() => setDetailGRN(grn)}>
                    <td className="py-3 pl-4 font-mono text-sm font-medium text-primary-700">{grn.grn_number}</td>
                    <td className="hidden sm:table-cell py-3 px-4 font-mono text-gray-600">{grn.po_number}</td>
                    <td className="py-3 px-4 text-gray-800">{grn.supplier_name}</td>
                    <td className="hidden sm:table-cell py-3 px-4 text-gray-500">{grn.received_date?.slice(0, 10)}</td>
                    <td className="py-3 px-4"><StatusBadge status={grn.status} /></td>
                    <td className="py-3 px-4 text-right font-medium">{formatCurrency(grn.total_amount)}</td>
                    <td className="py-3 pr-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setDetailGRN(grn)}
                        className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )
      )}

      {/* Modals */}
      {showPOModal && (
        <POModal
          suppliers={suppliers}
          products={products}
          branches={branches}
          onClose={() => setShowPOModal(false)}
        />
      )}

      {detailPO && fullPO && (
        <PODetail po={fullPO} onClose={() => setDetailPO(null)} onEdit={() => { setEditPO(fullPO); setDetailPO(null); }} />
      )}

      {editPO && fullPO?.po_id === editPO.po_id && (
        <POModal po={fullPO} suppliers={suppliers} products={products} branches={branches} onClose={() => setEditPO(null)} />
      )}

      {grnForPO && fullPO && (
        <GRNModal po={fullPO} onClose={() => setGrnForPO(null)} />
      )}

      {detailGRN && (
        <GRNDetail grn={detailGRN} onClose={() => setDetailGRN(null)} />
      )}

      {/* Report tabs */}
      {tab === 'summary' && <PurchasesSummaryTab />}
    </div>
  );
}
