import React, { useState, useRef, useEffect } from 'react';
import {
  MapPin, Plus, Trash2, Edit2, Link2, ZoomIn, ZoomOut, Move,
  Home, Mountain, Castle, Trees, Waves, Skull, Save, Download
} from 'lucide-react';
import LocationEditor from './LocationEditor';

const WorldMapBuilder = ({ locations, onUpdateLocations, bookId }) => {
  const canvasRef = useRef(null);
  const [locationNodes, setLocationNodes] = useState(() => {
    // Initialize with saved positions or auto-layout
    return locations.map((loc, idx) => ({
      ...loc,
      x: loc.x || 100 + (idx % 5) * 150,
      y: loc.y || 100 + Math.floor(idx / 5) * 150
    }));
  });

  const [connections, setConnections] = useState(() => {
    // Load existing connections from location data
    const conns = [];
    locations.forEach(loc => {
      loc.mapData?.connections?.forEach(connId => {
        if (!conns.find(c =>
          (c.from === loc.id && c.to === connId) ||
          (c.from === connId && c.to === loc.id)
        )) {
          conns.push({ from: loc.id, to: connId });
        }
      });
    });
    return conns;
  });

  const [selectedLocation, setSelectedLocation] = useState(null);
  const [editingLocation, setEditingLocation] = useState(null);
  const [connectingFrom, setConnectingFrom] = useState(null);
  const [draggingNode, setDraggingNode] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const locationIcons = {
    city: Home,
    village: Home,
    dungeon: Skull,
    castle: Castle,
    forest: Trees,
    mountain: Mountain,
    ocean: Waves,
    default: MapPin
  };

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    // ORDNANCE: canvas colours come from the live theme tokens (rule 6 —
    // JS-drawn colours must read the sheet, not hardcode one theme)
    const _cs = getComputedStyle(document.documentElement);
    const _tok = (n) => _cs.getPropertyValue(n).trim();
    const C = {
      blue: _tok('--blue') || '#6EA8D8',
      warn: _tok('--warn') || '#D9A441',
      line: _tok('--line2') || '#3A4B54',
      ink: _tok('--ink') || '#E4E7E4',
      dim: _tok('--dim2') || '#6E7F88',
      bg2: _tok('--bg2') || '#161E23',
      glass: _tok('--glass') || '#141B20',
    };

    // Set canvas size
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply transformations
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    // Draw connections
    ctx.strokeStyle = C.dim;
    ctx.lineWidth = 2;
    connections.forEach(conn => {
      const fromNode = locationNodes.find(n => n.id === conn.from);
      const toNode = locationNodes.find(n => n.id === conn.to);
      if (fromNode && toNode) {
        ctx.beginPath();
        ctx.moveTo(fromNode.x + 30, fromNode.y + 30);
        ctx.lineTo(toNode.x + 30, toNode.y + 30);
        ctx.stroke();
      }
    });

    // Draw nodes
    locationNodes.forEach(node => {
      const isSelected = selectedLocation?.id === node.id;
      const isConnecting = connectingFrom?.id === node.id;

      // Node circle
      ctx.fillStyle = isSelected ? C.blue : isConnecting ? C.warn : C.bg2;
      ctx.strokeStyle = isSelected ? C.blue : C.line;
      ctx.lineWidth = isSelected ? 3 : 2;

      ctx.beginPath();
      ctx.arc(node.x + 30, node.y + 30, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Node label
      ctx.fillStyle = C.ink;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.name.substring(0, 15), node.x + 30, node.y + 75);
    });

    ctx.restore();
  }, [locationNodes, connections, selectedLocation, connectingFrom, offset, zoom]);

  const handleCanvasMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - offset.x) / zoom;
    const y = (e.clientY - rect.top - offset.y) / zoom;

    // Check if clicking on a node
    const clickedNode = locationNodes.find(node => {
      const dx = x - (node.x + 30);
      const dy = y - (node.y + 30);
      return Math.sqrt(dx * dx + dy * dy) <= 30;
    });

    if (clickedNode) {
      if (connectingFrom) {
        // Create connection
        if (connectingFrom.id !== clickedNode.id) {
          setConnections(prev => [...prev, { from: connectingFrom.id, to: clickedNode.id }]);
        }
        setConnectingFrom(null);
      } else {
        setSelectedLocation(clickedNode);
        setDraggingNode(clickedNode);
      }
    } else {
      // Start panning
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (draggingNode) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - offset.x) / zoom;
      const y = (e.clientY - rect.top - offset.y) / zoom;

      setLocationNodes(prev => prev.map(node =>
        node.id === draggingNode.id
          ? { ...node, x: x - 30, y: y - 30 }
          : node
      ));
    } else if (isPanning) {
      setOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleCanvasMouseUp = () => {
    setDraggingNode(null);
    setIsPanning(false);
  };

  const addNewLocation = () => {
    const newLoc = {
      id: Date.now(),
      name: 'New Location',
      type: 'area',
      description: '',
      x: 100,
      y: 100,
      mapData: {
        connections: [],
        pointsOfInterest: [],
        loot: [],
        dangers: []
      }
    };
    setLocationNodes(prev => [...prev, newLoc]);
    setEditingLocation(newLoc);
  };

  const deleteLocation = (locId) => {
    if (!confirm('Delete this location?')) return;
    setLocationNodes(prev => prev.filter(n => n.id !== locId));
    setConnections(prev => prev.filter(c => c.from !== locId && c.to !== locId));
    setSelectedLocation(null);
  };

  const deleteConnection = (from, to) => {
    setConnections(prev => prev.filter(c =>
      !(c.from === from && c.to === to) && !(c.from === to && c.to === from)
    ));
  };

  const saveMap = async () => {
    // Update locations with positions and connections
    const updatedLocations = locationNodes.map(node => ({
      ...node,
      mapData: {
        ...node.mapData,
        connections: connections
          .filter(c => c.from === node.id || c.to === node.id)
          .map(c => c.from === node.id ? c.to : c.from)
      }
    }));

    await onUpdateLocations(updatedLocations);
    alert('Map saved successfully!');
  };

  const exportMapImage = () => {
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'world-map.png';
    link.click();
  };

  const autoLayout = () => {
    // Simple circle layout
    const centerX = 400;
    const centerY = 300;
    const radius = 200;
    const angleStep = (Math.PI * 2) / locationNodes.length;

    setLocationNodes(prev => prev.map((node, idx) => ({
      ...node,
      x: centerX + Math.cos(angleStep * idx) * radius - 30,
      y: centerY + Math.sin(angleStep * idx) * radius - 30
    })));
  };

  return (
    <div className="flex h-[calc(100vh-300px)] gap-4">
      {/* Toolbar */}
      <div className="w-64 bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <h3 className="font-semibold text-lg mb-4">World Map Tools</h3>

        <div className="space-y-2">
          <button
            onClick={addNewLocation}
            className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Location
          </button>

          <button
            onClick={() => setConnectingFrom(selectedLocation)}
            disabled={!selectedLocation}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Link2 className="w-4 h-4" />
            Connect Location
          </button>

          <button
            onClick={autoLayout}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition flex items-center justify-center gap-2"
          >
            <Move className="w-4 h-4" />
            Auto Layout
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="border-t pt-4">
          <label className="block text-sm font-medium mb-2">Zoom</label>
          <div className="flex gap-2">
            <button
              onClick={() => setZoom(prev => Math.max(0.5, prev - 0.1))}
              className="flex-1 px-3 py-2 bg-gray-100 rounded hover:bg-gray-200 transition"
            >
              <ZoomOut className="w-4 h-4 mx-auto" />
            </button>
            <div className="flex-1 px-3 py-2 bg-gray-100 rounded text-center text-sm font-medium">
              {Math.round(zoom * 100)}%
            </div>
            <button
              onClick={() => setZoom(prev => Math.min(2, prev + 0.1))}
              className="flex-1 px-3 py-2 bg-gray-100 rounded hover:bg-gray-200 transition"
            >
              <ZoomIn className="w-4 h-4 mx-auto" />
            </button>
          </div>
        </div>

        {/* Selected Location Info */}
        {selectedLocation && (
          <div className="border-t pt-4">
            <h4 className="font-semibold mb-2">Selected Location</h4>
            <div className="bg-gray-50 rounded p-3 space-y-2">
              <div className="font-medium">{selectedLocation.name}</div>
              <div className="text-sm text-gray-600">{selectedLocation.type}</div>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setEditingLocation(selectedLocation)}
                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition flex items-center justify-center gap-1"
                >
                  <Edit2 className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => deleteLocation(selectedLocation.id)}
                  className="px-3 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* Connections */}
              {connections.filter(c => c.from === selectedLocation.id || c.to === selectedLocation.id).length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <div className="text-xs font-medium text-gray-700 mb-2">Connections</div>
                  {connections
                    .filter(c => c.from === selectedLocation.id || c.to === selectedLocation.id)
                    .map((conn, idx) => {
                      const otherId = conn.from === selectedLocation.id ? conn.to : conn.from;
                      const otherLoc = locationNodes.find(n => n.id === otherId);
                      return (
                        <div key={idx} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1 mb-1">
                          <span>{otherLoc?.name || 'Unknown'}</span>
                          <button
                            onClick={() => deleteConnection(conn.from, conn.to)}
                            className="text-red-600 hover:text-red-800"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Save/Export */}
        <div className="border-t pt-4 space-y-2">
          <button
            onClick={saveMap}
            className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save Map
          </button>
          <button
            onClick={exportMapImage}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export Image
          </button>
        </div>

        {/* Legend */}
        <div className="border-t pt-4">
          <h4 className="font-semibold text-sm mb-2">Controls</h4>
          <ul className="text-xs text-gray-600 space-y-1">
            <li>• Click: Select location</li>
            <li>• Drag: Move location</li>
            <li>• Drag canvas: Pan view</li>
            <li>• Connect: Link locations</li>
          </ul>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg overflow-hidden relative">
        {connectingFrom && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-2 rounded-lg z-10 text-sm font-medium">
            Click another location to connect, or click here to cancel
            <button
              onClick={() => setConnectingFrom(null)}
              className="ml-2 text-yellow-900 hover:text-yellow-950"
            >
              ×
            </button>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-move"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />

        {/* Stats Overlay */}
        <div className="absolute bottom-4 right-4 bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm">
          <div className="font-medium">{locationNodes.length} Locations</div>
          <div className="text-gray-600">{connections.length} Connections</div>
        </div>
      </div>

      {/* Location Editor Modal */}
      {editingLocation && (
        <LocationEditor
          location={editingLocation}
          onClose={() => setEditingLocation(null)}
          onSave={(updatedLoc) => {
            setLocationNodes(prev => prev.map(n =>
              n.id === updatedLoc.id ? { ...n, ...updatedLoc } : n
            ));
            setEditingLocation(null);
          }}
        />
      )}
    </div>
  );
};

export default WorldMapBuilder;
