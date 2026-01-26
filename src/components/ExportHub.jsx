import React, { useState } from 'react';
import {
  Download, FileJson, FileText, Globe, MessageSquare, Sparkles, CheckCircle
} from 'lucide-react';
import axios from 'axios';

const ExportHub = ({ bookId, rpgData, bookData }) => {
  const [exporting, setExporting] = useState({});

  const exportToFoundry = async () => {
    setExporting({ foundry: true });
    try {
      const response = await axios.post('/api/rpg/export/foundry', {
        bookId,
        rpgData,
        bookData
      }, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${bookData.bookTitle || 'campaign'}-foundry.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export to Foundry VTT');
    } finally {
      setExporting({});
    }
  };

  const exportToRoll20 = async () => {
    setExporting({ roll20: true });
    try {
      const response = await axios.post('/api/rpg/export/roll20', {
        bookId,
        rpgData,
        bookData
      }, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${bookData.bookTitle || 'campaign'}-roll20.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export to Roll20');
    } finally {
      setExporting({});
    }
  };

  const exportCampaignPDF = async () => {
    setExporting({ pdf: true });
    try {
      const response = await axios.post('/api/rpg/export/campaign-pdf', {
        bookId,
        rpgData,
        bookData
      }, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${bookData.bookTitle || 'campaign'}-guide.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export campaign PDF');
    } finally {
      setExporting({});
    }
  };

  const exportHTML5Game = async () => {
    setExporting({ html5: true });
    try {
      const response = await axios.post('/api/rpg/export/html5', {
        bookId,
        rpgData,
        bookData
      }, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${bookData.bookTitle || 'game'}.html`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export HTML5 game');
    } finally {
      setExporting({});
    }
  };

  const exportOptions = [
    {
      id: 'foundry',
      title: 'Foundry VTT',
      description: 'Export as Foundry Virtual Tabletop module with actors, scenes, and journal entries',
      icon: FileJson,
      color: 'orange',
      action: exportToFoundry,
      features: ['Characters & NPCs', 'Scenes (Locations)', 'Quest Journals', 'Rollable Tables']
    },
    {
      id: 'roll20',
      title: 'Roll20',
      description: 'Export as Roll20 campaign with characters, handouts, and tokens',
      icon: FileJson,
      color: 'red',
      action: exportToRoll20,
      features: ['Character Sheets', 'Handouts', 'Attributes', 'GM Notes']
    },
    {
      id: 'pdf',
      title: 'Campaign PDF',
      description: 'Complete campaign guide with all characters, quests, locations, and encounters',
      icon: FileText,
      color: 'blue',
      action: exportCampaignPDF,
      features: ['Character Sheets', 'Quest Details', 'Location Maps', 'Encounter Stats']
    },
    {
      id: 'html5',
      title: 'HTML5 Game',
      description: 'Standalone playable web game - open in any browser',
      icon: Globe,
      color: 'green',
      action: exportHTML5Game,
      features: ['Interactive Quests', 'Character Progression', 'Self-contained', 'No Installation']
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg p-8">
        <div className="flex items-center gap-4">
          <Download className="w-12 h-12" />
          <div>
            <h2 className="text-3xl font-bold">Export Your RPG</h2>
            <p className="text-purple-100 mt-1">
              Export your campaign to popular VTT platforms or as standalone games
            </p>
          </div>
        </div>
      </div>

      {/* Export Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {exportOptions.map(option => {
          const Icon = option.icon;
          const isExporting = exporting[option.id];

          return (
            <div
              key={option.id}
              className={`bg-white border-2 border-${option.color}-200 rounded-lg p-6 hover:shadow-lg transition`}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className={`p-3 bg-${option.color}-100 rounded-lg`}>
                  <Icon className={`w-8 h-8 text-${option.color}-600`} />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold mb-2">{option.title}</h3>
                  <p className="text-sm text-gray-600">{option.description}</p>
                </div>
              </div>

              {/* Features */}
              <div className="mb-4">
                <div className="text-sm font-medium text-gray-700 mb-2">Includes:</div>
                <ul className="space-y-1">
                  {option.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-gray-600">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Export Button */}
              <button
                onClick={option.action}
                disabled={isExporting}
                className={`w-full py-3 bg-${option.color}-600 text-white rounded-lg hover:bg-${option.color}-700 transition font-semibold flex items-center justify-center gap-2 disabled:opacity-50`}
              >
                {isExporting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    Export to {option.title}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="font-semibold mb-4">Export Content Summary</h3>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600">{rpgData.characters?.length || 0}</div>
            <div className="text-sm text-gray-600">Characters</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{rpgData.quests?.length || 0}</div>
            <div className="text-sm text-gray-600">Quests</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">{rpgData.locations?.length || 0}</div>
            <div className="text-sm text-gray-600">Locations</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-orange-600">{rpgData.encounters?.length || 0}</div>
            <div className="text-sm text-gray-600">Encounters</div>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          Export Tips
        </h3>
        <ul className="space-y-2 text-sm text-blue-800">
          <li>• <strong>Foundry VTT</strong>: Import the JSON file in Foundry's module installer</li>
          <li>• <strong>Roll20</strong>: Use the Transmogrifier to import campaign data</li>
          <li>• <strong>PDF</strong>: Print-friendly campaign guide for offline use</li>
          <li>• <strong>HTML5</strong>: Share the file directly - works in any web browser</li>
        </ul>
      </div>
    </div>
  );
};

export default ExportHub;
