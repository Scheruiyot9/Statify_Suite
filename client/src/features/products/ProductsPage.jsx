import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Edit2, ToggleLeft, ToggleRight, Package, Download, Upload, CheckCircle2, XCircle, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ImageUpload from '@/components/ui/ImageUpload';
import { PageSpinner } from '@/components/ui/Spinner';
import { usePermission } from '@/hooks/usePermission';
import { exportToExcel } from '@/utils/exportExcel';

function ProductForm({ initial, categories, taxRates, onSave, onClose }) {
  const [form, setForm] = useState({
    product_name:    initial?.product_name    ?? '',
    sku:             initial?.sku             ?? '',
    barcode:         initial?.barcode         ?? '',
    description:     initial?.description     ?? '',
    category_id:     initial?.category_id     ?? '',
    base_price:      initial?.base_price      ?? '',
    cost_price:      initial?.cost_price      ?? '',
    unit_of_measure: initial?.unit_of_measure ?? 'Unit',
    reorder_level:   initial?.reorder_level   ?? 5,
    initial_stock:   0,
    image_url:       initial?.image_url       ?? null,
    tax_template_id: initial?.tax_template_id ?? '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';
  const labelCls = 'block text-xs font-medium text-gray-700 mb-1';

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({
        ...form,
        base_price:      parseFloat(form.base_price),
        cost_price:      form.cost_price ? parseFloat(form.cost_price) : null,
        reorder_level:   parseInt(form.reorder_level),
        initial_stock:   parseInt(form.initial_stock || 0),
        image_url:       form.image_url || null,
        tax_template_id: form.tax_template_id || null,
      });
    }} className="space-y-4">

      {/* Image upload — top of form */}
      <div className="flex items-start gap-4">
        <ImageUpload
          value={form.image_url}
          onChange={(v) => set('image_url', v)}
          label="Product Image"
          size="md"
        />
        <div className="flex-1 space-y-3">
          <div>
            <label className={labelCls}>Product Name *</label>
            <input required className={inputCls} value={form.product_name} onChange={(e) => set('product_name', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>SKU *</label>
              <input required className={inputCls} value={form.sku} onChange={(e) => set('sku', e.target.value)} disabled={!!initial} />
            </div>
            <div>
              <label className={labelCls}>Barcode</label>
              <input className={inputCls} value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Category</label>
          <select className={inputCls} value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">— None —</option>
            {categories?.map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Unit of Measure</label>
          <input className={inputCls} value={form.unit_of_measure} onChange={(e) => set('unit_of_measure', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Selling Price (KES) *</label>
          <input required type="number" min="0" step="0.01" className={inputCls} value={form.base_price} onChange={(e) => set('base_price', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Cost Price (KES)</label>
          <input type="number" min="0" step="0.01" className={inputCls} value={form.cost_price} onChange={(e) => set('cost_price', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Tax Rate</label>
          <select className={inputCls} value={form.tax_template_id} onChange={(e) => set('tax_template_id', e.target.value)}>
            <option value="">— Use company default —</option>
            {taxRates?.map((t) => (
              <option key={t.tax_template_id} value={t.tax_template_id}>
                {t.template_name} ({t.tax_rate}%{t.is_inclusive ? ' incl.' : ''})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Reorder Level</label>
          <input type="number" min="0" className={inputCls} value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} />
        </div>
        {!initial && (
          <div>
            <label className={labelCls}>Opening Stock</label>
            <input type="number" min="0" className={inputCls} value={form.initial_stock} onChange={(e) => set('initial_stock', e.target.value)} />
          </div>
        )}
        <div className="col-span-full">
          <label className={labelCls}>Description</label>
          <textarea rows={2} className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit">{initial ? 'Save Changes' : 'Create Product'}</Button>
      </div>
    </form>
  );
}

function ProductDetail({ product }) {
  if (!product) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        {product.image_url ? (
          <img src={product.image_url} alt={product.product_name}
            className="h-20 w-20 flex-shrink-0 rounded-xl object-cover border border-gray-100" />
        ) : (
          <div className="h-20 w-20 flex-shrink-0 rounded-xl bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-2xl">
            {product.product_name[0]}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-lg leading-tight">{product.product_name}</p>
          <p className="font-mono text-sm text-gray-400 mt-0.5">{product.sku}</p>
          {product.barcode && <p className="text-xs text-gray-400 mt-0.5">Barcode: {product.barcode}</p>}
          <span className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${product.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {product.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Selling Price', value: formatCurrency(product.base_price) },
          { label: 'Cost Price',    value: product.cost_price ? formatCurrency(product.cost_price) : '—' },
          { label: 'Category',      value: product.category_name || '—' },
          { label: 'Tax',           value: product.tax_template_name || 'Default' },
          { label: 'Unit',          value: product.unit_of_measure },
          { label: 'Reorder Level', value: product.reorder_level },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="font-semibold text-gray-900 mt-0.5">{value}</p>
          </div>
        ))}
      </div>
      {product.description && (
        <p className="text-sm text-gray-600 border-t border-gray-100 pt-3">{product.description}</p>
      )}
    </div>
  );
}

function CategoryForm({ onSave, onClose }) {
  const [name, setName] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ category_name: name }); }} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Category Name *</label>
        <input required value={name} onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit">Add Category</Button>
      </div>
    </form>
  );
}

const CSV_COLUMNS = [
  'product_name', 'sku', 'barcode', 'base_price', 'cost_price',
  'unit_of_measure', 'description', 'category_name', 'reorder_level', 'initial_stock',
];

function normaliseHeaders(raw) {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [
      k.toLowerCase().replace(/\s+/g, '_'), v,
    ])
  );
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([CSV_COLUMNS]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.writeFile(wb, 'products_import_template.csv', { bookType: 'csv' });
}

function ImportProductsModal({ open, onClose, onImported }) {
  const [rows, setRows]         = useState([]);
  const [result, setResult]     = useState(null);
  const [importing, setImport]  = useState(false);
  const fileRef = useRef(null);

  function reset() {
    setRows([]); setResult(null); setImport(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleClose() { reset(); onClose(); }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb   = XLSX.read(ev.target.result, { type: 'binary' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
      setRows(data.map(normaliseHeaders));
      setResult(null);
    };
    reader.readAsBinaryString(file);
  }

  async function handleImport() {
    if (!rows.length) return;
    setImport(true);
    try {
      const res = await api.post('/products/import', { products: rows });
      const r = res.data.data;
      setResult(r);
      if (r.imported > 0) onImported();
      toast.success(`Imported ${r.imported} of ${r.total} products`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed');
    } finally {
      setImport(false);
    }
  }

  const hasErrors = result?.results?.some((r) => !r.success);

  return (
    <Modal open={open} onClose={handleClose} title="Import Products from CSV / Excel" size="lg">
      <div className="space-y-4">
        {!result && (
          <>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={downloadTemplate}>
                Download Template
              </Button>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFile} />
              <Button variant="primary" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                Choose File
              </Button>
              {rows.length > 0 && (
                <span className="text-sm text-gray-500">{rows.length} row{rows.length !== 1 ? 's' : ''} loaded</span>
              )}
            </div>

            {rows.length > 0 && (
              <>
                <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 text-xs">
                  <table className="w-full">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        {CSV_COLUMNS.map((c) => (
                          <th key={c} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.slice(0, 20).map((row, i) => (
                        <tr key={i} className={!row.product_name || isNaN(parseFloat(row.base_price)) ? 'bg-red-50' : ''}>
                          {CSV_COLUMNS.map((c) => (
                            <td key={c} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-[140px] truncate">{String(row[c] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > 20 && (
                    <p className="px-3 py-2 text-gray-400 text-xs">…and {rows.length - 20} more rows</p>
                  )}
                </div>
                <p className="text-xs text-gray-400">Rows highlighted in red are missing <strong>product_name</strong> or <strong>base_price</strong> and will be skipped.</p>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={reset}>Clear</Button>
                  <Button variant="primary" size="sm" loading={importing} onClick={handleImport}>
                    Import {rows.length} Products
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {result && (
          <div className="space-y-3">
            <div className="flex gap-4 rounded-lg bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold">{result.imported} imported</span>
              </div>
              {result.failed > 0 && (
                <div className="flex items-center gap-2 text-red-600">
                  <XCircle className="h-5 w-5" />
                  <span className="font-semibold">{result.failed} failed</span>
                </div>
              )}
            </div>
            {hasErrors && (
              <div className="max-h-48 overflow-auto rounded-lg border border-red-100 bg-red-50 p-3 text-xs space-y-1">
                {result.results.filter((r) => !r.success).map((r) => (
                  <p key={r.row} className="text-red-700">
                    <strong>Row {r.row}</strong>{r.product_name ? ` (${r.product_name})` : ''}: {r.error}
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={reset}>Import Another File</Button>
              <Button variant="primary" size="sm" onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function ProductsPage() {
  const qc = useQueryClient();
  const { hasCapability } = usePermission();
  const canManageProducts = hasCapability('products.manage');
  const [search, setSearch]       = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [page, setPage]           = useState(1);
  const [modal, setModal]           = useState(null);
  const [viewProduct, setViewProduct] = useState(null);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['products-mgmt', search, catFilter, page],
    queryFn: () => api.get('/products', { params: { search, categoryId: catFilter, page, limit: 25 } }).then((r) => r.data.data),
    keepPreviousData: true,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => api.get('/products/categories').then((r) => r.data.data),
  });

  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => api.get('/tax-rates').then((r) => r.data.data),
  });

  const createMut = useMutation({
    mutationFn: (d) => api.post('/products', d),
    onSuccess: () => { toast.success('Product created'); qc.invalidateQueries(['products-mgmt']); setModal(null); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to create product'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...d }) => api.put(`/products/${id}`, d),
    onSuccess: () => { toast.success('Product updated'); qc.invalidateQueries(['products-mgmt']); setModal(null); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }) => api.put(`/products/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries(['products-mgmt']),
  });

  const catMut = useMutation({
    mutationFn: (d) => api.post('/products/categories', d),
    onSuccess: () => { toast.success('Category added'); qc.invalidateQueries(['product-categories']); setModal(null); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const products = data?.products ?? [];
  const total    = data?.total    ?? 0;
  const pages    = data?.pages    ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, SKU or barcode…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none">
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
        </select>
        <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />}
          onClick={() => exportToExcel('products', products, [
            'product_name','sku','barcode','category_name','base_price','is_active',
          ], ['Product Name','SKU','Barcode','Category','Price','Active'])}>
          Export
        </Button>
        {canManageProducts && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowImport(true)} icon={<Upload className="h-4 w-4" />}>
              Import CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setModal('category')} icon={<Plus className="h-4 w-4" />}>
              Category
            </Button>
            <Button variant="primary" size="sm" onClick={() => setModal('create')} icon={<Plus className="h-4 w-4" />}>
              Add Product
            </Button>
          </>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-600">SKU</th>
                <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-gray-600">Category</th>
                <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-gray-600">Tax</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Price</th>
                <th className="hidden sm:table-cell px-4 py-3 text-right font-medium text-gray-600">Cost</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                {canManageProducts && <th className="px-4 py-3 text-center font-medium text-gray-600">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {products.map((p) => (
                <tr key={p.product_id} className="hover:bg-gray-50 active:bg-gray-100 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.product_name}
                          className="h-8 w-8 flex-shrink-0 rounded-lg object-cover border border-gray-100" />
                      ) : (
                        <div className="h-8 w-8 flex-shrink-0 rounded-lg bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-xs">
                          {p.product_name[0]}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-gray-900">{p.product_name}</p>
                        {p.barcode && <p className="text-xs text-gray-400">{p.barcode}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-gray-600">{p.sku}</td>
                  <td className="hidden md:table-cell px-4 py-3 text-gray-500">{p.category_name ?? '—'}</td>
                  <td className="hidden md:table-cell px-4 py-3">
                    {p.tax_template_name
                      ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{p.tax_template_name}</span>
                      : <span className="text-xs text-gray-300">default</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCurrency(p.base_price)}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-right text-gray-500">{p.cost_price ? formatCurrency(p.cost_price) : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManageProducts && (
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => setViewProduct(p)}
                        className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                        View
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {products.length === 0 && (
                <tr><td colSpan={canManageProducts ? 8 : 7} className="py-12 text-center text-gray-400">
                  <Package className="mx-auto mb-2 h-8 w-8 opacity-30" />No products found
                </td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">Page {page} of {pages} ({total} total)</p>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      <Modal open={canManageProducts && !!viewProduct} onClose={() => setViewProduct(null)}
        title={viewProduct?.product_name ?? 'Product Details'} size="md"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth
              onClick={() => { toggleMut.mutate({ id: viewProduct.product_id, is_active: !viewProduct.is_active }); setViewProduct(null); }}>
              {viewProduct?.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button fullWidth icon={<Edit2 className="h-4 w-4" />}
              onClick={() => { setModal(viewProduct); setViewProduct(null); }}>
              Edit
            </Button>
          </div>
        }
      >
        <ProductDetail product={viewProduct} />
      </Modal>

      <Modal open={canManageProducts && (modal === 'create' || (!!modal && typeof modal === 'object'))} onClose={() => setModal(null)}
        title={modal === 'create' ? 'New Product' : `Edit: ${modal?.product_name}`} size="lg">
        <ProductForm initial={modal !== 'create' ? modal : undefined} categories={categories} taxRates={taxRates}
          onClose={() => setModal(null)}
          onSave={(d) => modal === 'create' ? createMut.mutate(d) : updateMut.mutate({ id: modal.product_id, ...d })} />
      </Modal>

      <Modal open={canManageProducts && modal === 'category'} onClose={() => setModal(null)} title="Add Category" size="sm">
        <CategoryForm onClose={() => setModal(null)} onSave={(d) => catMut.mutate(d)} />
      </Modal>

      <ImportProductsModal
        open={canManageProducts && showImport}
        onClose={() => setShowImport(false)}
        onImported={() => qc.invalidateQueries(['products-mgmt'])}
      />
    </div>
  );
}
