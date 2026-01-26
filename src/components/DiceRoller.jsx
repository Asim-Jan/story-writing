import React, { useState } from 'react';
import { Dices, Plus, Minus, Trash2, RotateCcw, History } from 'lucide-react';

const DiceRoller = ({ onRoll }) => {
  const [diceConfig, setDiceConfig] = useState([
    { id: 1, type: 20, count: 1, modifier: 0 }
  ]);
  const [rollHistory, setRollHistory] = useState([]);
  const [lastRoll, setLastRoll] = useState(null);
  const [isRolling, setIsRolling] = useState(false);

  const diceTypes = [4, 6, 8, 10, 12, 20, 100];

  const addDice = () => {
    setDiceConfig([...diceConfig, {
      id: Date.now(),
      type: 20,
      count: 1,
      modifier: 0
    }]);
  };

  const updateDice = (id, field, value) => {
    setDiceConfig(diceConfig.map(dice =>
      dice.id === id ? { ...dice, [field]: parseInt(value) || 0 } : dice
    ));
  };

  const removeDice = (id) => {
    if (diceConfig.length > 1) {
      setDiceConfig(diceConfig.filter(dice => dice.id !== id));
    }
  };

  const rollDice = (sides) => {
    return Math.floor(Math.random() * sides) + 1;
  };

  const performRoll = () => {
    setIsRolling(true);

    // Simulate rolling animation
    setTimeout(() => {
      const results = diceConfig.map(dice => {
        const rolls = [];
        for (let i = 0; i < dice.count; i++) {
          rolls.push(rollDice(dice.type));
        }
        const sum = rolls.reduce((a, b) => a + b, 0);
        return {
          ...dice,
          rolls,
          sum,
          total: sum + dice.modifier
        };
      });

      const grandTotal = results.reduce((sum, r) => sum + r.total, 0);

      const rollResult = {
        timestamp: new Date(),
        config: diceConfig,
        results,
        total: grandTotal
      };

      setLastRoll(rollResult);
      setRollHistory([rollResult, ...rollHistory.slice(0, 9)]); // Keep last 10
      setIsRolling(false);

      if (onRoll) {
        onRoll(rollResult);
      }
    }, 500);
  };

  const quickRoll = (notation) => {
    // Parse notation like "1d20+5" or "2d6"
    const match = notation.match(/(\d+)d(\d+)([+-]\d+)?/);
    if (match) {
      const count = parseInt(match[1]);
      const type = parseInt(match[2]);
      const modifier = match[3] ? parseInt(match[3]) : 0;

      setDiceConfig([{ id: Date.now(), type, count, modifier }]);
      setTimeout(performRoll, 100);
    }
  };

  const getDiceColor = (type) => {
    const colors = {
      4: 'bg-red-500',
      6: 'bg-blue-500',
      8: 'bg-green-500',
      10: 'bg-yellow-500',
      12: 'bg-purple-500',
      20: 'bg-indigo-500',
      100: 'bg-pink-500'
    };
    return colors[type] || 'bg-gray-500';
  };

  return (
    <div className="space-y-6">
      {/* Dice Configuration */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Dices className="w-5 h-5" />
            Dice Roller
          </h3>
          <button
            onClick={addDice}
            className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 transition text-sm flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Add Dice
          </button>
        </div>

        <div className="space-y-3">
          {diceConfig.map((dice) => (
            <div key={dice.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg">
              {/* Count */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => updateDice(dice.id, 'count', Math.max(1, dice.count - 1))}
                  className="p-1 hover:bg-gray-200 rounded"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={dice.count}
                  onChange={(e) => updateDice(dice.id, 'count', e.target.value)}
                  className="w-12 px-2 py-1 border border-gray-300 rounded text-center"
                />
                <button
                  onClick={() => updateDice(dice.id, 'count', Math.min(20, dice.count + 1))}
                  className="p-1 hover:bg-gray-200 rounded"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <span className="font-bold">d</span>

              {/* Dice Type */}
              <select
                value={dice.type}
                onChange={(e) => updateDice(dice.id, 'type', e.target.value)}
                className="px-3 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
              >
                {diceTypes.map(type => (
                  <option key={type} value={type}>d{type}</option>
                ))}
              </select>

              {/* Modifier */}
              <div className="flex items-center gap-1">
                <span className="text-gray-600">+</span>
                <input
                  type="number"
                  value={dice.modifier}
                  onChange={(e) => updateDice(dice.id, 'modifier', e.target.value)}
                  className="w-16 px-2 py-1 border border-gray-300 rounded text-center"
                  placeholder="0"
                />
              </div>

              {/* Preview */}
              <div className="flex-1 text-sm text-gray-600 font-mono">
                {dice.count}d{dice.type}{dice.modifier !== 0 ? (dice.modifier > 0 ? `+${dice.modifier}` : dice.modifier) : ''}
              </div>

              {/* Remove */}
              <button
                onClick={() => removeDice(dice.id)}
                disabled={diceConfig.length === 1}
                className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Roll Button */}
        <button
          onClick={performRoll}
          disabled={isRolling}
          className={`w-full mt-4 py-3 rounded-lg font-semibold text-lg transition flex items-center justify-center gap-2 ${
            isRolling
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white'
          }`}
        >
          {isRolling ? (
            <>
              <RotateCcw className="w-5 h-5 animate-spin" />
              Rolling...
            </>
          ) : (
            <>
              <Dices className="w-5 h-5" />
              Roll Dice
            </>
          )}
        </button>

        {/* Quick Roll Buttons */}
        <div className="mt-4 pt-4 border-t">
          <div className="text-sm font-medium text-gray-700 mb-2">Quick Rolls (D&D 5e)</div>
          <div className="grid grid-cols-4 gap-2">
            {['1d20', '1d20+5', '2d6', '1d8+3', '1d12', '4d6', '1d10', '1d4'].map(notation => (
              <button
                key={notation}
                onClick={() => quickRoll(notation)}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm font-mono transition"
              >
                {notation}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Last Roll Result */}
      {lastRoll && (
        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Dices className="w-5 h-5 text-purple-600" />
            Roll Result
          </h3>

          <div className="space-y-3">
            {lastRoll.results.map((result, idx) => (
              <div key={idx} className="bg-white rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono font-medium">
                    {result.count}d{result.type}{result.modifier !== 0 ? (result.modifier > 0 ? `+${result.modifier}` : result.modifier) : ''}
                  </span>
                  <span className="text-2xl font-bold text-purple-600">{result.total}</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {result.rolls.map((roll, rollIdx) => (
                    <div
                      key={rollIdx}
                      className={`w-10 h-10 ${getDiceColor(result.type)} text-white rounded-lg flex items-center justify-center font-bold shadow-lg ${
                        roll === result.type ? 'ring-2 ring-yellow-400 animate-pulse' : ''
                      }`}
                    >
                      {roll}
                    </div>
                  ))}
                  {result.modifier !== 0 && (
                    <div className="flex items-center px-3 py-2 bg-gray-100 rounded-lg">
                      <span className="text-sm font-medium">
                        {result.modifier > 0 ? `+${result.modifier}` : result.modifier}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {lastRoll.results.length > 1 && (
            <div className="mt-4 pt-4 border-t border-purple-200 flex items-center justify-between">
              <span className="text-lg font-semibold">Grand Total</span>
              <span className="text-3xl font-bold text-purple-600">{lastRoll.total}</span>
            </div>
          )}
        </div>
      )}

      {/* Roll History */}
      {rollHistory.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <History className="w-5 h-5" />
              Roll History
            </h3>
            <button
              onClick={() => setRollHistory([])}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Clear
            </button>
          </div>

          <div className="space-y-2">
            {rollHistory.map((roll, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 bg-gray-50 rounded hover:bg-gray-100 transition cursor-pointer"
                onClick={() => setLastRoll(roll)}
              >
                <div className="flex-1">
                  <div className="font-mono text-sm">
                    {roll.config.map(d =>
                      `${d.count}d${d.type}${d.modifier !== 0 ? (d.modifier > 0 ? `+${d.modifier}` : d.modifier) : ''}`
                    ).join(' + ')}
                  </div>
                  <div className="text-xs text-gray-500">
                    {roll.timestamp.toLocaleTimeString()}
                  </div>
                </div>
                <div className="text-xl font-bold text-purple-600">{roll.total}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DiceRoller;
