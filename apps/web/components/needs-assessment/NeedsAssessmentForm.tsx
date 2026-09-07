'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  createNeedsAssessment,
  getQuestionnaire,
  updateNeedsAssessment,
  type NeedsAssessment,
  type NeedsAssessmentQuestion,
} from '../../lib/needs-assessment/needs-assessment-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle, inputStyle, labelStyle } from '../auth/auth-form.styles';
import { sectionStyle } from '../lead/lead.styles';
import { questionPromptStyle, questionRowStyle } from './needs-assessment.styles';

type Answers = Record<string, boolean | number>;

interface NeedsAssessmentFormProps {
  /** 'create' needs a riskProfileId; 'edit' needs assessmentId + initialAnswers. */
  mode: 'create' | 'edit';
  riskProfileId?: string;
  assessmentId?: string;
  initialAnswers?: Answers;
  onSaved: (assessment: NeedsAssessment) => void;
}

/** Builds a fully-answered starting map (every boolean No, every number 0)
 * so the payload the API expects — all question ids present — is always
 * complete, and the officer just flips what applies. These are
 * business-risk questions, not sensitive personal data, so a "No" default
 * is not a privacy-by-default concern (Part 6.3 covers pre-ticked
 * *consent/sensitive* fields — see lib/forms/privacy-by-default.ts). */
function defaultAnswers(questions: NeedsAssessmentQuestion[]): Answers {
  const answers: Answers = {};
  for (const q of questions) answers[q.id] = q.type === 'number' ? 0 : false;
  return answers;
}

export function NeedsAssessmentForm({
  mode,
  riskProfileId,
  assessmentId,
  initialAnswers,
  onSaved,
}: NeedsAssessmentFormProps) {
  const [questions, setQuestions] = useState<NeedsAssessmentQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Answers>(initialAnswers ?? {});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { questions: qs } = await getQuestionnaire();
        setQuestions(qs);
        setAnswers((current) =>
          Object.keys(current).length > 0 ? current : defaultAnswers(qs),
        );
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load the questionnaire — try again.',
        );
      }
    })();
  }, []);

  function setAnswer(id: string, value: boolean | number) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const saved =
        mode === 'create'
          ? await createNeedsAssessment({
              riskProfileId: riskProfileId as string,
              questionnaireAnswers: answers,
            })
          : await updateNeedsAssessment(assessmentId as string, answers);
      onSaved(saved);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not save the needs assessment — try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!questions && !error) return <p>Loading questionnaire…</p>;

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>Risk questionnaire</h2>
      <form onSubmit={(e) => void handleSubmit(e)}>
        {(questions ?? []).map((q) => {
          const value = answers[q.id];
          if (q.type === 'number') {
            return (
              <div key={q.id} style={questionRowStyle}>
                <label htmlFor={`q-${q.id}`} style={{ ...labelStyle, ...questionPromptStyle, marginTop: 0 }}>
                  {q.prompt}
                </label>
                <input
                  id={`q-${q.id}`}
                  type="number"
                  min={0}
                  value={typeof value === 'number' ? value : 0}
                  onChange={(e) => setAnswer(q.id, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  style={{ ...inputStyle, width: '8rem' }}
                />
              </div>
            );
          }
          return (
            <fieldset key={q.id} style={{ ...questionRowStyle, border: 'none', margin: 0, padding: '0.75rem 0' }}>
              <legend style={{ ...questionPromptStyle, padding: 0 }}>{q.prompt}</legend>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name={`q-${q.id}`}
                    checked={value === true}
                    onChange={() => setAnswer(q.id, true)}
                  />
                  Yes
                </label>
                <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name={`q-${q.id}`}
                    checked={value === false}
                    onChange={() => setAnswer(q.id, false)}
                  />
                  No
                </label>
              </div>
            </fieldset>
          );
        })}

        <button type="submit" disabled={isSubmitting || !questions} style={buttonStyle}>
          {isSubmitting
            ? 'Saving…'
            : mode === 'create'
              ? 'Save draft & see recommended cover'
              : 'Save questionnaire'}
        </button>
        {error ? (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
