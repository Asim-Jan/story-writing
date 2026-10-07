import React, { useState } from 'react';
import { ScanSearch, Loader, CheckCircle, AlertCircle, Clock, Users, MapPin, Route, FileText } from 'lucide-react';
import { useMediaJobsContext, MediaJobStatus } from '../contexts/MediaJobsContext';

// Book analysis as a book media job (type "analysis"): reads the book chapter
// by chapter and finds characters, places, plotlines, a timeline and chapter
// summaries. The book-level jobs hook merges the result (filling only empty
// fields) and acks it after the save. Started automatically after an import,
// or here for any book.

const CHAPTER_STATUS = {
  pending: { label: 'Waiting', icon: Clock, cls: 'text-[var(--dim)]' },
  reading: { label: 'Reading', icon: Loader, cls: 'text-[var(--blue)]', spin: true },
  done: { label: 'Done', icon: CheckCircle, cls: 'text-[var(--ok)]' },
  failed: { label: 'Failed', icon: AlertCircle, cls: 'text-[var(--red)]' },
};

const AnalysisPanel = ({ data, bookId, autosave }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  const jobs = jobsFor('book', bookId).filter(j => j.type === 'analysis');
  const running = jobs.find(j => j.status === 'running');
  const chapters = data.chapters || [];
  const withText = chapters.filter(ch => String(ch.content || '').trim());
  const mark = data.metadata?.importAnalysis;
  const found = {
    characters: (data.characters || []).filter(c => c.fromImport).length,
    locations: (data.locations || []).filter(l => l.fromImport).length,
    plotlines: (data.plotlines || []).filter(p => p.fromImport).length,
    events: (data.timelines || []).filter(e => e.fromImport).length,
  };
  const chapterName = (id) => {
    const ch = chapters.find(c => String(c.id) === String(id));
    return ch ? `Chapter ${ch.number}: ${ch.title}` : 'Chapter';
  };

  const analyze = async () => {
    setError(null);
    setStarting(true);
    try {
      // The server reads the saved book: save pending edits first.
      if (autosave?.saveNow && autosave.status && autosave.status !== 'saved') await autosave.saveNow();
      await startJob('analysis', { type: 'book', id: bookId }, {}, `Analysis: ${data.bookTitle || 'book'}`);
    } catch (err) {
      setError(`Could not start the analysis: ${err.message}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6" data-testid="analysis-panel">
      <div className="card p-6">
        <div className="flex items-start gap-3 mb-4">
          <ScanSearch className="w-7 h-7 text-[var(--blue)] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-[var(--ink)]">Book analysis</h2>
            <p className="text-sm text-[var(--dim)]">
              Reads every chapter and finds the characters, places, plotlines and timeline, and writes a summary for chapters
              that have none. It only fills empty fields: anything you have written stays as it is.
            </p>
          </div>
        </div>

        {data.importedFrom && (
          <p className="text-xs text-[var(--dim)] mono mb-3">
            Imported from {data.importedFrom.filename || data.importedFrom.fileName || 'a file'}
            {data.importedFrom.importedAt ? ` on ${new Date(data.importedFrom.importedAt).toLocaleDateString()}` : ''}
          </p>
        )}

        {mark?.analyzedAt && (
          <p className="text-sm text-[var(--ink)] mb-3" data-testid="analysis-last">
            {mark.status === 'completed' ? 'Last analysed' : 'Partly analysed'} {new Date(mark.analyzedAt).toLocaleString()}.
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-sm">
          <span className="pill justify-center" data-testid="found-characters"><Users size={12} />{found.characters} characters</span>
          <span className="pill justify-center"><MapPin size={12} />{found.locations} places</span>
          <span className="pill justify-center"><Route size={12} />{found.plotlines} plotlines</span>
          <span className="pill justify-center"><FileText size={12} />{found.events} events</span>
        </div>

        <button
          type="button"
          onClick={analyze}
          disabled={starting || !!running || withText.length === 0}
          className="btn pri"
          data-testid="analyze-book"
        >
          {starting || running ? <Loader size={16} className="animate-spin" /> : <ScanSearch size={16} />}
          {running ? 'Analysing...' : mark ? 'Analyze this book again' : 'Analyze this book'}
        </button>
        {withText.length === 0 && <p className="text-xs text-[var(--dim)] mt-2">Add some chapter text first.</p>}
        {error && <div className="border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2 mt-3" role="alert">{error}</div>}
      </div>

      {jobs.map(job => (
        <div key={job.jobId} className="card p-5" data-testid="analysis-job">
          <MediaJobStatus job={job} hint={job.status === 'running' ? 'It keeps going if you leave this tab or close the book.' : undefined} />
          {job.status === 'running' && job.progress?.chapters?.length > 0 && (
            <ol className="mt-3 grid sm:grid-cols-2 gap-1">
              {job.progress.chapters.map(row => {
                const st = CHAPTER_STATUS[row.status] || CHAPTER_STATUS.pending;
                const Icon = st.icon;
                return (
                  <li key={row.chapterId} className="flex items-center gap-2 text-sm" data-testid="analysis-chapter" data-status={row.status}>
                    <Icon size={14} className={`${st.cls} ${st.spin ? 'animate-spin' : ''} flex-shrink-0`} />
                    <span className="flex-1 truncate text-[var(--ink)]">{chapterName(row.chapterId)}</span>
                    <span className={`text-xs mono ${st.cls}`}>{st.label}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
};

export default AnalysisPanel;
