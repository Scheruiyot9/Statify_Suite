import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { X } from 'lucide-react';

const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-full mx-4' };

export default function Modal({ open, onClose, title, children, size = 'md', footer }) {
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

        {/* Centered dialog on every screen size */}
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel
              className={`w-full ${sizes[size]} max-h-[92vh] rounded-xl bg-white shadow-xl flex flex-col`}
            >
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
