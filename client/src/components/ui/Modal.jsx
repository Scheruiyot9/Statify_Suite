import { Dialog, Transition } from '@headlessui/react';
import { Fragment, useRef, useState } from 'react';
import { X } from 'lucide-react';

const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-full mx-4' };

export default function Modal({ open, onClose, title, children, size = 'md', footer }) {
  const [dragY, setDragY] = useState(0);
  const touchStartY = useRef(0);
  const dragging = useRef(false);

  const handleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY;
    dragging.current = true;
  };

  const handleTouchMove = (e) => {
    if (!dragging.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) setDragY(delta);
  };

  const handleTouchEnd = () => {
    dragging.current = false;
    if (dragY > 100) {
      setDragY(0);
      onClose();
    } else {
      setDragY(0);
    }
  };

  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150"  leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
        </Transition.Child>

        {/* Phones (<640px): bottom sheet; sm and up: centered dialog */}
        <div className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            enterTo="opacity-100 translate-y-0 sm:scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0 sm:scale-100"
            leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
          >
            <Dialog.Panel
              className={`w-full ${sizes[size]} max-h-[92vh] rounded-t-2xl sm:rounded-xl bg-white shadow-xl flex flex-col`}
              style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined, transition: dragY === 0 ? 'transform 0.2s' : 'none' }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {/* Drag handle — phones only (bottom-sheet mode) */}
              <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
                <div className="h-1 w-10 rounded-full bg-gray-300" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 lg:px-6 lg:py-4 flex-shrink-0">
                <Dialog.Title className="text-base font-semibold text-gray-900">{title}</Dialog.Title>
                <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="overflow-y-auto px-4 py-4 lg:px-6 flex-1">{children}</div>

              {/* Footer */}
              {footer && <div className="border-t border-gray-100 px-4 py-4 lg:px-6 flex-shrink-0">{footer}</div>}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
