import { useRef, useState, useEffect } from "react";

type DraggablePopupProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  headerColor?: string; // new prop for dynamic header color
};

export default function DraggablePopup({
  title,
  children,
  onClose,
  headerColor = "#333", // default dark gray
}: DraggablePopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState({ x: 150, y: 620 });
  const [size, setSize] = useState({ w: 700, h: 870 });

  const dragData = useRef({ dragging: false, offsetX: 0, offsetY: 0 });
  const resizeData = useRef({ resizing: false, startX: 0, startY: 0, startW: 0, startH: 0 });

  const onMouseDownHeader = (e: React.MouseEvent) => {
    dragData.current = {
      dragging: true,
      offsetX: e.clientX - pos.x,
      offsetY: e.clientY - pos.y,
    };
  };

  const onMouseMove = (e: MouseEvent) => {
    if (dragData.current.dragging) {
      setPos({
        x: e.clientX - dragData.current.offsetX,
        y: e.clientY - dragData.current.offsetY,
      });
    }

    if (resizeData.current.resizing) {
      const dx = e.clientX - resizeData.current.startX;
      const dy = e.clientY - resizeData.current.startY;

      setSize({
        w: Math.max(250, resizeData.current.startW + dx),
        h: Math.max(150, resizeData.current.startH + dy),
      });
    }
  };

  const stopActions = () => {
    dragData.current.dragging = false;
    resizeData.current.resizing = false;
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    resizeData.current = {
      resizing: true,
      startX: e.clientX,
      startY: e.clientY,
      startW: size.w,
      startH: size.h,
    };
  };

  // Attach global mousemove and mouseup to handle dragging outside the popup
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => onMouseMove(e);
    const handleMouseUp = () => stopActions();

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div
      ref={popupRef}
      className="fixed z-50 bg-white shadow-2xl border rounded-md"
      style={{ top: pos.y, left: pos.x, width: size.w, height: size.h }}
    >
      {/* Header (draggable area) */}
      <div
        className="cursor-move px-3 py-2 rounded-t-md flex justify-between items-center"
        style={{ backgroundColor: headerColor, color: "white" }}
        onMouseDown={onMouseDownHeader}
      >
        <span className="font-semibold">{title}</span>
        <button onClick={onClose} className="text-white hover:text-red-300">
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="overflow-auto h-full">{children}</div>

      {/* Resize handle */}
      <div
        className="absolute bottom-1 right-1 w-4 h-4 bg-gray-400 cursor-se-resize"
        onMouseDown={onResizeMouseDown}
      />
    </div>
  );
}
