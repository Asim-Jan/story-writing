import React, { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

const RelationshipGraph = ({ characters, onClose }) => {
  const canvasRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth * 2; // Retina display
    const height = canvas.height = canvas.offsetHeight * 2;

    ctx.clearRect(0, 0, width, height);
    ctx.save();

    // Apply transformations
    ctx.translate(offset.x * 2, offset.y * 2);
    ctx.scale(scale, scale);

    // Calculate positions in a circle
    const centerX = width / (2 * scale);
    const centerY = height / (2 * scale);
    const radius = Math.min(width, height) / (3 * scale);

    const positions = characters.map((char, index) => {
      const angle = (index / characters.length) * 2 * Math.PI - Math.PI / 2;
      return {
        char,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      };
    });

    // Draw relationship lines first (so they're behind nodes)
    characters.forEach((char, index) => {
      const pos1 = positions[index];
      (char.relationships || []).forEach(rel => {
        const targetIndex = characters.findIndex(c => c.id === rel.characterId);
        if (targetIndex !== -1) {
          const pos2 = positions[targetIndex];

          // Line color based on relationship type
          let color = '#9CA3AF'; // Gray default
          if (rel.type === 'Family' || rel.type === 'Parent' || rel.type === 'Child' || rel.type === 'Sibling') {
            color = '#3B82F6'; // Blue for family
          } else if (rel.type === 'Friend') {
            color = '#10B981'; // Green for friends
          } else if (rel.type === 'Rival' || rel.type === 'Enemy') {
            color = '#EF4444'; // Red for conflict
          } else if (rel.type === 'Mentor' || rel.type === 'Student') {
            color = '#8B5CF6'; // Purple for mentorship
          } else if (rel.type === 'Spouse') {
            color = '#EC4899'; // Pink for romance
          }

          ctx.beginPath();
          ctx.moveTo(pos1.x, pos1.y);
          ctx.lineTo(pos2.x, pos2.y);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw label at midpoint
          const midX = (pos1.x + pos2.x) / 2;
          const midY = (pos1.y + pos2.y) / 2;
          ctx.font = '14px sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Background for text
          const textWidth = ctx.measureText(rel.type).width;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(midX - textWidth / 2 - 4, midY - 10, textWidth + 8, 20);

          ctx.fillStyle = color;
          ctx.fillText(rel.type, midX, midY);
        }
      });
    });

    // Draw character nodes
    positions.forEach(({ char, x, y }) => {
      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, 50, 0, 2 * Math.PI);
      ctx.fillStyle = '#FCD34D'; // Amber
      ctx.fill();
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Character name
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = '#1F2937';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Wrap text if too long
      const maxWidth = 90;
      const words = char.name.split(' ');
      let line = '';
      let lineY = y;

      if (ctx.measureText(char.name).width > maxWidth) {
        words.forEach((word, i) => {
          const testLine = line + (line ? ' ' : '') + word;
          if (ctx.measureText(testLine).width > maxWidth && line) {
            ctx.fillText(line, x, lineY - 7);
            line = word;
            lineY += 14;
          } else {
            line = testLine;
          }
        });
        ctx.fillText(line, x, lineY + 7);
      } else {
        ctx.fillText(char.name, x, y);
      }

      // Role below name
      if (char.role) {
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#6B7280';
        ctx.fillText(char.role, x, y + 30);
      }
    });

    ctx.restore();
  }, [characters, scale, offset]);

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.3, Math.min(3, prev * delta)));
  };

  const handleMouseDown = (e) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e) => {
    if (dragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full h-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-6 py-4 flex items-center justify-between rounded-t-xl">
          <div>
            <h2 className="text-2xl font-bold">Character Relationships</h2>
            <p className="text-sm text-amber-100">Visual map of character connections</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setScale(prev => Math.min(3, prev * 1.2))}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
              title="Zoom In"
            >
              <ZoomIn size={20} />
            </button>
            <button
              onClick={() => setScale(prev => Math.max(0.3, prev * 0.8))}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
              title="Zoom Out"
            >
              <ZoomOut size={20} />
            </button>
            <button
              onClick={resetView}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
              title="Reset View"
            >
              <Maximize2 size={20} />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-hidden p-6 bg-gray-50">
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-move"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        </div>

        {/* Legend */}
        <div className="px-6 py-4 bg-white border-t border-gray-200 rounded-b-xl">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Relationship Types:</h3>
          <div className="flex flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-blue-500"></div>
              <span className="text-gray-600">Family</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-green-500"></div>
              <span className="text-gray-600">Friend</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-red-500"></div>
              <span className="text-gray-600">Rival/Enemy</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-purple-500"></div>
              <span className="text-gray-600">Mentor/Student</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-pink-500"></div>
              <span className="text-gray-600">Spouse</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-gray-400"></div>
              <span className="text-gray-600">Other</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Tip: Scroll to zoom, drag to pan</p>
        </div>
      </div>
    </div>
  );
};

export default RelationshipGraph;
