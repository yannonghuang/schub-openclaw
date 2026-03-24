interface ModalProps {
  children: React.ReactNode;
  // Accept either naming
  isOpen?: boolean; // optional
  handleClose?: () => void; // optional
  open?: boolean;   // preferred
  onClose?: () => void; // preferred
}

export const Modal: React.FC<ModalProps> = ({
  children,
  open,
  onClose,
  isOpen,
  handleClose,
}) => {
  // Use either pair
  const visible = open ?? isOpen ?? false;
  const close = onClose ?? handleClose ?? (() => {});

  if (!visible) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30">
      <div className="bg-white p-4 rounded shadow-lg w-2/3">
        <button onClick={close} className="mb-2 text-right">Close</button>
        {children}
      </div>
    </div>
  );
};
