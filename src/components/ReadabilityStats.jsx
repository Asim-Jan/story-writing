import React, { useState } from 'react';
import { BookOpen, Clock, Target, TrendingUp, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { calculateReadability, getReadabilityColor, getSentenceComplexity } from '../utils/readability';

export default function ReadabilityStats({ text, compact = false }) {
  const [expanded, setExpanded] = useState(false);
  const metrics = calculateReadability(text);

  if (compact) {
    return (
      <div className="flex items-center gap-4 text-sm text-gray-600">
        <div className="flex items-center gap-1">
          <BookOpen size={14} />
          <span>Grade {metrics.fleschKincaidGrade}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={14} />
          <span>{metrics.readingTime} min</span>
        </div>
        <div className={`flex items-center gap-1 font-semibold ${getReadabilityColor(metrics.fleschScore)}`}>
          <TrendingUp size={14} />
          <span>{metrics.fleschScore}/100</span>
        </div>
      </div>
    );
  }

  const sentenceComplexity = getSentenceComplexity(metrics.avgWordsPerSentence);

  return (
    <div className="bg-white border-2 border-gray-200 rounded-lg shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <BookOpen className="text-indigo-600" size={20} />
          </div>
          <div className="text-left">
            <h3 className="font-bold text-gray-800">Readability Analysis</h3>
            <p className="text-sm text-gray-600">{metrics.readingLevel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-2xl font-bold ${getReadabilityColor(metrics.fleschScore)}`}>
            {metrics.fleschScore}
          </span>
          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {expanded && (
        <div className="p-4 border-t border-gray-200 space-y-4">
          {/* Main Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <Target className="text-blue-600" size={18} />
                <p className="text-sm font-semibold text-gray-700">Reading Ease</p>
              </div>
              <p className={`text-3xl font-bold ${getReadabilityColor(metrics.fleschScore)}`}>
                {metrics.fleschScore}
              </p>
              <p className="text-xs text-gray-600 mt-1">Flesch Score (0-100)</p>
              <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    metrics.fleschScore >= 70
                      ? 'bg-green-500'
                      : metrics.fleschScore >= 50
                      ? 'bg-yellow-500'
                      : metrics.fleschScore >= 30
                      ? 'bg-orange-500'
                      : 'bg-red-500'
                  }`}
                  style={{ width: `${metrics.fleschScore}%` }}
                ></div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-4 rounded-lg border border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="text-purple-600" size={18} />
                <p className="text-sm font-semibold text-gray-700">Grade Level</p>
              </div>
              <p className="text-3xl font-bold text-purple-600">{metrics.fleschKincaidGrade}</p>
              <p className="text-xs text-gray-600 mt-1">Flesch-Kincaid Grade</p>
              <p className="text-sm text-purple-700 mt-2 font-medium">
                {metrics.fleschKincaidGrade < 6
                  ? 'Elementary'
                  : metrics.fleschKincaidGrade < 9
                  ? 'Middle School'
                  : metrics.fleschKincaidGrade < 13
                  ? 'High School'
                  : 'College+'}
              </p>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-4 rounded-lg border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="text-green-600" size={18} />
                <p className="text-sm font-semibold text-gray-700">Reading Time</p>
              </div>
              <p className="text-3xl font-bold text-green-600">
                {metrics.readingTime}
                <span className="text-lg ml-1">min</span>
              </p>
              <p className="text-xs text-gray-600 mt-1">At 200 words/minute</p>
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-lg border border-amber-200">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="text-amber-600" size={18} />
                <p className="text-sm font-semibold text-gray-700">Sentence Complexity</p>
              </div>
              <p className={`text-2xl font-bold ${sentenceComplexity.color}`}>
                {sentenceComplexity.level}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Avg {metrics.avgWordsPerSentence} words/sentence
              </p>
            </div>
          </div>

          {/* Detailed Stats */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Info size={16} />
              Detailed Statistics
            </h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Sentences:</span>
                <span className="font-semibold text-gray-800">{metrics.sentences}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Words:</span>
                <span className="font-semibold text-gray-800">{metrics.words}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Syllables:</span>
                <span className="font-semibold text-gray-800">{metrics.syllables}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Avg Syllables/Word:</span>
                <span className="font-semibold text-gray-800">{metrics.avgSyllablesPerWord}</span>
              </div>
            </div>
          </div>

          {/* Tips */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="lbl mb-2">Writing Tips</p>
            <ul className="text-xs text-blue-800 space-y-1">
              {metrics.fleschScore < 50 && (
                <li>• Try using shorter sentences to improve readability</li>
              )}
              {metrics.avgWordsPerSentence > 20 && (
                <li>• Break down complex sentences into simpler ones</li>
              )}
              {metrics.fleschKincaidGrade > 12 && (
                <li>• Consider simplifying vocabulary for wider audience reach</li>
              )}
              {metrics.fleschScore >= 70 && (
                <li>✓ Great readability! Your text is clear and accessible</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
