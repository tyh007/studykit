/**
 * v0.5 P4 — project AI panel: persisted, shared-by-default threads,
 * small-step moves, think-first, drafts that change nothing until
 * applied, and a graceful AI-off state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { ProjectAiPanel } from './ProjectAiPanel';
import { ResearchProvider, type ResearchContextValue } from './researchContext';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import type { ProviderChatRequest, ProviderRouter } from '../ai/kernel/providerRouter';
import type { AiContextRef } from '../../domain/aiThread';
import { makeResearchProject } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
const CONTEXT: AiContextRef[] = [
  { kind: 'argument', objectId: P, label: 'Your argument', locator: null, excerpt: '1. Sleep helps memory' },
  { kind: 'project', objectId: null, label: 'Your question', locator: null, excerpt: 'Does sleep help memory?' },
];

let repo: MemoryResearchRepository;

function makeRouter(reply = 'One study used only young adults. Does it hold for older people?') {
  const chat = vi.fn(async (_req: ProviderChatRequest) => ({ content: reply, provider: 'ollama' as const, model: 'llama3' }));
  const router: ProviderRouter = { probe: async () => ({ aiAvailable: true, providerName: 'ollama' }), chat };
  return { router, chat };
}

function mount(router?: ProviderRouter) {
  const onOpenArgument = vi.fn();
  const value: ResearchContextValue = {
    repository: repo,
    openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}', { status: 200 }) }),
    ...(router ? { providerRouter: router } : {}),
  };
  const ui = (
    <ResearchProvider value={value}>
      <ProjectAiPanel projectId={P} userId="u-1" context={CONTEXT} onClose={() => undefined} onOpenArgument={onOpenArgument} />
    </ResearchProvider>
  );
  return { ...render(ui), onOpenArgument, ui };
}

async function ask(text: string): Promise<void> {
  const input = await screen.findByTestId('ai-input');
  fireEvent.change(input, { target: { value: text } });
  await waitFor(() => expect(screen.getByTestId('ai-send')).toBeEnabled());
  fireEvent.click(screen.getByTestId('ai-send'));
}

beforeEach(async () => {
  localStorage.clear();
  repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => tx.putProject(makeResearchProject({ id: P })));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ProjectAiPanel', () => {
  it('explains when AI is off, keeps the typed text and stays readable', async () => {
    mount();
    expect(await screen.findByTestId('ai-off')).toHaveTextContent('AI is off');
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: 'Is this convincing?' } });
    expect(screen.getByTestId('ai-send')).toBeDisabled();
    expect(screen.getByTestId('ai-input')).toHaveValue('Is this convincing?');
  });

  it('asks in a shared conversation that is still there after a restart', async () => {
    const { router, chat } = makeRouter();
    const first = mount(router);
    await ask('Is my argument convincing?');
    expect(await screen.findByText(/Does it hold for older people\?/)).toBeInTheDocument();
    expect(screen.getByTestId('ai-visibility')).toHaveTextContent('Shared with this project');
    expect(screen.getByText(/Local AI · llama3 · saw Your argument, Your question/)).toBeInTheDocument();
    expect(chat.mock.calls[0]![0].messages[0]!.content).toContain('1. Sleep helps memory');

    first.unmount();
    mount(router);
    expect(await screen.findByText(/Does it hold for older people\?/)).toBeInTheDocument();
    expect(screen.getByTestId('ai-thread-select')).toHaveDisplayValue('Is my argument convincing?');
  });

  it('leaves out context the user removed', async () => {
    const { router, chat } = makeRouter();
    mount(router);
    fireEvent.click(await screen.findByRole('button', { name: 'Don’t share Your argument' }));
    expect(screen.getAllByTestId('ai-context-chip').map((c) => c.textContent)).toEqual(['Your question×']);
    await ask('Hi');
    await waitFor(() => expect(chat).toHaveBeenCalled());
    expect(chat.mock.calls[0]![0].messages[0]!.content).not.toContain('Sleep helps memory');
  });

  it('challenges in one chosen voice', async () => {
    const { router, chat } = makeRouter('Your sample is small. How many participants?');
    mount(router);
    await waitFor(() => expect(screen.getByTestId('ai-challenge')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ai-challenge'));
    fireEvent.click(within(screen.getByTestId('ai-role-menu')).getByTestId('ai-role-methods'));
    expect(await screen.findByText('Methods reviewer')).toBeInTheDocument();
    expect(screen.getAllByTestId('ai-message')[0]).toHaveTextContent('Challenge this as the methods reviewer.');
    expect(chat.mock.calls[0]![0].messages[0]!.content).toContain('Speak as the methods reviewer');
  });

  it('asks for your own ideas first, and records it honestly when you skip', async () => {
    const { router } = makeRouter('Time of day matters too.');
    mount(router);
    await waitFor(() => expect(screen.getByTestId('ai-missing')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ai-missing'));
    expect(screen.getByTestId('ai-think-first')).toHaveTextContent('First, your own ideas');
    expect(screen.getByTestId('ai-missing-send')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ai-missing-skip'));
    expect(await screen.findByText('Asked before writing own ideas')).toBeInTheDocument();
    const [question] = await repo.listAiMessages({ projectId: P });
    expect(question?.skippedOwnThinking).toBe(true);
  });

  it('adds a suggested point only when applied, then shows where it went', async () => {
    const { router } = makeRouter('Mechanism is missing.\n```suggestions\n{"points": ["Slow-wave sleep replays memories"]}\n```');
    const { onOpenArgument } = mount(router);
    await ask('What is weak?');
    const card = await screen.findByTestId('ai-draft');
    expect(card).toHaveTextContent('Slow-wave sleep replays memories');
    expect(screen.getByText('Mechanism is missing.')).toBeInTheDocument();
    expect(await repo.listClaims({ projectId: P })).toHaveLength(0);

    fireEvent.click(within(card).getByTestId('ai-draft-apply'));
    expect(await within(card).findByTestId('ai-draft-decision')).toHaveTextContent('Added to your argument');
    const [claim] = await repo.listClaims({ projectId: P });
    expect(claim).toMatchObject({ title: 'Slow-wave sleep replays memories', aiSuggested: true });
    expect(onOpenArgument).toHaveBeenCalledWith(claim!.id);
  });

  it('starts a private conversation on request and can share it later, not the other way', async () => {
    const { router } = makeRouter();
    mount(router);
    fireEvent.click(await screen.findByTestId('ai-private'));
    await ask('Just for me');
    expect(await screen.findByTestId('ai-visibility')).toHaveTextContent('Private · Share with project');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Share with project' }));
    await waitFor(() => expect(screen.getByTestId('ai-visibility')).toHaveTextContent('Shared with this project'));
  });

  it('shows a failed reply with a way to try again', async () => {
    const chat = vi.fn().mockRejectedValueOnce(new Error('Ollama is not running')).mockResolvedValue({ content: 'Back now.', provider: 'ollama', model: 'm' });
    mount({ probe: async () => ({ aiAvailable: true, providerName: 'ollama' }), chat });
    await ask('Hello?');
    expect(await screen.findByText('Couldn’t answer: Ollama is not running')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ai-retry'));
    expect(await screen.findByText('Back now.')).toBeInTheDocument();
  });
});
