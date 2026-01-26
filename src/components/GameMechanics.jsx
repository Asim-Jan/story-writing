import React, { useState } from 'react';
import {
  Swords, Target, Zap, Shield, Heart, Calculator, Sparkles, Crown
} from 'lucide-react';
import DiceRoller from './DiceRoller';

const GameMechanics = ({ ruleSystem, party }) => {
  const [activeTab, setActiveTab] = useState('dice');
  const [combatState, setCombatState] = useState({
    attacker: null,
    defender: null,
    attackRoll: null,
    damage: null
  });
  const [skillCheck, setSkillCheck] = useState({
    dc: 15,
    skill: 'Perception',
    modifier: 0,
    result: null
  });
  const [initiative, setInitiative] = useState([]);

  // Combat Calculator
  const calculateAttack = (attacker, defender, attackRoll) => {
    const hit = attackRoll >= defender.ac;
    return {
      hit,
      attackRoll,
      targetAC: defender.ac,
      message: hit ? `Hit! Roll for damage.` : `Miss! (${attackRoll} vs AC ${defender.ac})`
    };
  };

  const calculateDamage = (damageRoll, defender) => {
    const actualDamage = Math.max(0, damageRoll);
    const newHP = Math.max(0, defender.hp - actualDamage);
    return {
      damage: actualDamage,
      newHP,
      killed: newHP === 0,
      message: newHP === 0 ? `${defender.name} is defeated!` : `${defender.name} takes ${actualDamage} damage (${newHP}/${defender.maxHp} HP)`
    };
  };

  // Skill Check Calculator
  const rollSkillCheck = () => {
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + skillCheck.modifier;
    const success = total >= skillCheck.dc;

    setSkillCheck(prev => ({
      ...prev,
      result: {
        roll,
        total,
        success,
        degree: total >= skillCheck.dc + 5 ? 'critical' : total >= skillCheck.dc ? 'success' : total >= skillCheck.dc - 5 ? 'partial' : 'failure'
      }
    }));
  };

  // Initiative Tracker
  const rollInitiative = (combatants) => {
    const initiatives = combatants.map(c => ({
      ...c,
      initiative: Math.floor(Math.random() * 20) + 1 + (c.initiativeBonus || 0),
      hp: c.hp || c.maxHp
    }));
    initiatives.sort((a, b) => b.initiative - a.initiative);
    setInitiative(initiatives);
  };

  const updateCombatantHP = (id, newHP) => {
    setInitiative(prev => prev.map(c =>
      c.id === id ? { ...c, hp: Math.max(0, Math.min(newHP, c.maxHp)) } : c
    ));
  };

  const renderDiceTab = () => (
    <DiceRoller onRoll={(result) => console.log('Roll:', result)} />
  );

  const renderCombatTab = () => (
    <div className="space-y-6">
      {/* Attack Calculator */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Swords className="w-5 h-5 text-red-600" />
          Attack Calculator
        </h3>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Attack Roll (d20)</label>
            <input
              type="number"
              min="1"
              max="20"
              placeholder="Roll result"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              onChange={(e) => setCombatState(prev => ({ ...prev, attackRoll: parseInt(e.target.value) }))}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Attack Bonus</label>
            <input
              type="number"
              placeholder="+0"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Target AC</label>
            <input
              type="number"
              placeholder="15"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Advantage/Disadvantage</label>
            <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
              <option>Normal</option>
              <option>Advantage</option>
              <option>Disadvantage</option>
            </select>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
          <div className="font-medium text-blue-900 mb-1">How to Use:</div>
          <ol className="text-blue-800 space-y-1">
            <li>1. Roll d20 for attack</li>
            <li>2. Add attack bonus</li>
            <li>3. Compare to target AC</li>
            <li>4. If ≥ AC, roll damage</li>
          </ol>
        </div>
      </div>

      {/* Damage Calculator */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-600" />
          Damage Calculator
        </h3>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Damage Roll</label>
            <input
              type="text"
              placeholder="2d6+3"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Damage Type</label>
            <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
              <option>Slashing</option>
              <option>Piercing</option>
              <option>Bludgeoning</option>
              <option>Fire</option>
              <option>Cold</option>
              <option>Lightning</option>
              <option>Poison</option>
              <option>Necrotic</option>
              <option>Radiant</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Critical Hit?</label>
            <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
              <option>No</option>
              <option>Yes (double dice)</option>
            </select>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium text-yellow-900">Total Damage:</span>
            <span className="text-2xl font-bold text-yellow-700">—</span>
          </div>
        </div>
      </div>

      {/* Healing Calculator */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Heart className="w-5 h-5 text-green-600" />
          Healing Calculator
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Healing Amount</label>
            <input
              type="text"
              placeholder="2d4+2"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Target Max HP</label>
            <input
              type="number"
              placeholder="50"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderSkillsTab = () => (
    <div className="space-y-6">
      {/* Skill Check */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-600" />
          Skill Check Resolver
        </h3>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Skill</label>
            <select
              value={skillCheck.skill}
              onChange={(e) => setSkillCheck(prev => ({ ...prev, skill: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            >
              {ruleSystem === 'd20' ? (
                <>
                  <option>Acrobatics</option>
                  <option>Animal Handling</option>
                  <option>Arcana</option>
                  <option>Athletics</option>
                  <option>Deception</option>
                  <option>History</option>
                  <option>Insight</option>
                  <option>Intimidation</option>
                  <option>Investigation</option>
                  <option>Medicine</option>
                  <option>Nature</option>
                  <option>Perception</option>
                  <option>Performance</option>
                  <option>Persuasion</option>
                  <option>Religion</option>
                  <option>Sleight of Hand</option>
                  <option>Stealth</option>
                  <option>Survival</option>
                </>
              ) : (
                <option>Custom Skill</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Modifier</label>
            <input
              type="number"
              value={skillCheck.modifier}
              onChange={(e) => setSkillCheck(prev => ({ ...prev, modifier: parseInt(e.target.value) || 0 }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Difficulty (DC)</label>
            <input
              type="number"
              value={skillCheck.dc}
              onChange={(e) => setSkillCheck(prev => ({ ...prev, dc: parseInt(e.target.value) || 15 }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        <button
          onClick={rollSkillCheck}
          className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
        >
          Roll Skill Check
        </button>

        {skillCheck.result && (
          <div className={`mt-4 p-4 rounded-lg border-2 ${
            skillCheck.result.success
              ? 'bg-green-50 border-green-300'
              : 'bg-red-50 border-red-300'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">Result:</span>
              <span className="text-2xl font-bold">
                {skillCheck.result.roll} + {skillCheck.modifier} = {skillCheck.result.total}
              </span>
            </div>
            <div className={`text-lg font-semibold ${
              skillCheck.result.success ? 'text-green-700' : 'text-red-700'
            }`}>
              {skillCheck.result.degree === 'critical' && '🎯 Critical Success!'}
              {skillCheck.result.degree === 'success' && '✓ Success'}
              {skillCheck.result.degree === 'partial' && '~ Partial Success'}
              {skillCheck.result.degree === 'failure' && '✗ Failure'}
            </div>
            <div className="text-sm text-gray-600 mt-1">
              DC {skillCheck.dc} | {skillCheck.skill}
            </div>
          </div>
        )}

        {/* DC Reference */}
        <div className="mt-4 bg-gray-50 rounded-lg p-4">
          <div className="text-sm font-medium text-gray-700 mb-2">Difficulty Class Reference:</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>DC 5: <span className="text-green-600">Very Easy</span></div>
            <div>DC 10: <span className="text-blue-600">Easy</span></div>
            <div>DC 15: <span className="text-yellow-600">Medium</span></div>
            <div>DC 20: <span className="text-orange-600">Hard</span></div>
            <div>DC 25: <span className="text-red-600">Very Hard</span></div>
            <div>DC 30: <span className="text-purple-600">Nearly Impossible</span></div>
          </div>
        </div>
      </div>

      {/* Saving Throw */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-600" />
          Saving Throw
        </h3>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Save Type</label>
            <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
              <option>Strength</option>
              <option>Dexterity</option>
              <option>Constitution</option>
              <option>Intelligence</option>
              <option>Wisdom</option>
              <option>Charisma</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Save Bonus</label>
            <input
              type="number"
              placeholder="+2"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Save DC</label>
            <input
              type="number"
              placeholder="15"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        <button className="w-full mt-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">
          Roll Save
        </button>
      </div>
    </div>
  );

  const renderInitiativeTab = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Crown className="w-5 h-5 text-yellow-600" />
            Initiative Tracker
          </h3>
          <button
            onClick={() => party && rollInitiative(party)}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition"
          >
            Roll Initiative
          </button>
        </div>

        {initiative.length > 0 ? (
          <div className="space-y-2">
            {initiative.map((combatant, idx) => (
              <div
                key={combatant.id}
                className={`flex items-center gap-4 p-4 rounded-lg border-2 ${
                  idx === 0 ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="text-2xl font-bold text-gray-400 w-8">
                  {idx + 1}
                </div>

                <div className="flex-1">
                  <div className="font-semibold">{combatant.name}</div>
                  <div className="text-sm text-gray-600">
                    Initiative: {combatant.initiative}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-red-600" />
                  <input
                    type="number"
                    value={combatant.hp}
                    onChange={(e) => updateCombatantHP(combatant.id, parseInt(e.target.value) || 0)}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-center"
                  />
                  <span className="text-gray-600">/ {combatant.maxHp}</span>
                </div>

                <div className="w-32">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        combatant.hp > combatant.maxHp * 0.5 ? 'bg-green-500' :
                        combatant.hp > combatant.maxHp * 0.25 ? 'bg-yellow-500' :
                        'bg-red-500'
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, (combatant.hp / combatant.maxHp) * 100))}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Crown className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Roll initiative to start combat tracking</p>
          </div>
        )}
      </div>
    </div>
  );

  const tabs = [
    { id: 'dice', label: 'Dice Roller', icon: Calculator },
    { id: 'combat', label: 'Combat', icon: Swords },
    { id: 'skills', label: 'Skills & Saves', icon: Target },
    { id: 'initiative', label: 'Initiative', icon: Crown }
  ];

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="flex border-b">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-4 py-3 font-medium text-sm flex items-center justify-center gap-2 transition ${
                  activeTab === tab.id
                    ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'dice' && renderDiceTab()}
        {activeTab === 'combat' && renderCombatTab()}
        {activeTab === 'skills' && renderSkillsTab()}
        {activeTab === 'initiative' && renderInitiativeTab()}
      </div>
    </div>
  );
};

export default GameMechanics;
