import { useRef } from 'react';
import { Image, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ImageUpload({
  value,
  onChange,
  label      = 'Image',
  maxSizeMB  = 2,
  size       = 'md',   // 'sm' | 'md' | 'lg'
  className  = '',
}) {
  const inputRef = useRef(null);

  const dim = { sm: 'h-16 w-16', md: 'h-24 w-24', lg: 'h-32 w-32' }[size] ?? 'h-24 w-24';

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > maxSizeMB * 1024 * 1024) {
      toast.error(`Image must be under ${maxSizeMB} MB`);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => onChange(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className={className}>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-gray-700">{label}</label>
      )}

      {value ? (
        <div className={`relative ${dim} flex-shrink-0`}>
          <img
            src={value}
            alt="Preview"
            className={`${dim} rounded-xl object-cover border border-gray-200`}
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1 rounded-b-xl bg-black/50 py-1 text-[10px] text-white hover:bg-black/70 transition-colors"
          >
            <Upload className="h-2.5 w-2.5" />
            Change
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`${dim} flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-500 transition-all`}
        >
          <Image className="h-5 w-5" />
          <span className="text-[10px] font-medium">Upload</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
