// SPDX-License-Identifier: Apache-2.0
import express from 'express';
import { initApp, shutdownApp } from '../../app';
import { loadTestConfig } from '../../config/loader';
import { createTestProject, withTestContext } from '../../test.setup';
import {
  createStubPatient,
  isStubPatient,
  promoteStub,
  deleteStub,
  STUB_TAG_SYSTEM,
} from '../stub';
import { RFS_DRAFT_TAG } from '../codesystems';

describe('rfs/stub', () => {
  const app = express();

  beforeAll(async () => {
    const config = await loadTestConfig();
    await initApp(app, config);
  });

  afterAll(async () => {
    await shutdownApp();
  });

  test('createStubPatient stamps the rfs-draft tag and sets active=false', async () => {
    const { repo } = await createTestProject({ withRepo: true });
    await withTestContext(async () => {
      const stub = await createStubPatient(repo);
      expect(stub.active).toBe(false);
      expect(isStubPatient(stub)).toBe(true);
      expect(stub.meta?.tag?.[0]?.system).toBe(STUB_TAG_SYSTEM);
      expect(stub.meta?.tag?.[0]?.code).toBe(RFS_DRAFT_TAG);
      expect(stub.name).toEqual([]);
    });
  });

  test('promoteStub removes the tag, sets active=true, applies patch', async () => {
    const { repo } = await createTestProject({ withRepo: true });
    await withTestContext(async () => {
      const stub = await createStubPatient(repo);
      const promoted = await promoteStub(repo, stub.id, {
        name: [{ family: 'Patient', given: ['Test'] }],
      });
      expect(promoted.active).toBe(true);
      expect(isStubPatient(promoted)).toBe(false);
      expect(promoted.name?.[0]?.family).toBe('Patient');
    });
  });

  test('deleteStub removes the stub from the repo', async () => {
    const { repo } = await createTestProject({ withRepo: true });
    await withTestContext(async () => {
      const stub = await createStubPatient(repo);
      await deleteStub(repo, stub.id);
      await expect(repo.readResource('Patient', stub.id)).rejects.toThrow();
    });
  });

  test('deleteStub refuses to delete a non-stub Patient', async () => {
    const { repo } = await createTestProject({ withRepo: true });
    await withTestContext(async () => {
      const real = await repo.createResource({
        resourceType: 'Patient',
        active: true,
        name: [{ family: 'Real', given: ['Patient'] }],
      });
      await expect(deleteStub(repo, real.id)).rejects.toThrow(/not a stub/);
    });
  });
});
