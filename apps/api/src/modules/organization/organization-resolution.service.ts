import { Injectable, NotFoundException } from '@nestjs/common';
import type { Organization } from '@ibms/db';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextService } from '../../common/org-context/org-context.service';

/** What the login screen needs to know before it renders. */
export interface ResolvedOrganization {
  id: string;
  legalName: string;
  legalNameAr: string | null;
  subdomain: string;
  status: string;
}

/**
 * Part II §4.10 — resolves a brokerage office from the subdomain, BEFORE any
 * authentication step runs.
 *
 * `alsalam.ibms-app.example` and `rawabi.ibms-app.example` are different
 * offices; the login form that follows is already scoped to whichever one the
 * host named.
 *
 * ## Why this reads on the bypass connection
 *
 * Resolving which Organization a request belongs to is, by definition, a read
 * that happens before that Organization is known — the same category Part I §1
 * carves out for the auth-identity bootstrap. `Organization` is not itself
 * tenant-scoped (it IS the tenant), but this runs with no org context at all,
 * so it is stated explicitly rather than left to chance.
 */
@Injectable()
export class OrganizationResolutionService {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly prisma: PrismaService,
    private readonly orgContext: OrgContextService,
  ) {}

  /**
   * Extracts the office label from a Host header.
   *
   * Returns null — meaning "this host names no office" — for anything without a
   * distinguishing label: bare `localhost`, an IP address, the apex domain, or
   * a conventional non-tenant label like `www` or `api`. That is the case every
   * local and CI request falls into, and treating it as a resolution failure
   * would make the whole system unreachable outside production DNS.
   */
  subdomainFromHost(host: string | undefined): string | null {
    if (!host) return null;
    const hostname = host.split(':')[0].trim().toLowerCase();
    if (!hostname || hostname === 'localhost') return null;
    // An IPv4 literal, or an IPv6 one in brackets.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('['))
      return null;

    const labels = hostname.split('.');
    // Needs at least label.domain.tld to carry an office label.
    if (labels.length < 3) return null;

    const label = labels[0];
    if (['www', 'api', 'app'].includes(label)) return null;
    return label;
  }

  /** The office a subdomain names, or null. */
  async findBySubdomain(subdomain: string): Promise<Organization | null> {
    return this.orgContext.runUnscoped('auth-bootstrap', async () =>
      // `await` inside the bypass is load-bearing: a Prisma promise handed back
      // unexecuted would run after the store closed. Same trap as every other
      // site that wraps a query in AsyncLocalStorage.
      this.prisma.client.organization.findUnique({ where: { subdomain } }),
    );
  }

  /**
   * The public resolution the sign-in screen calls.
   *
   * A subdomain nobody has registered is a 404 with no detail: replying "no
   * such office" for one label and something else for another would let anyone
   * enumerate which brokerages are on the platform, which §4.10.4 rules out
   * even for an office administrator.
   */
  async resolve(subdomain: string): Promise<ResolvedOrganization> {
    const organization = await this.findBySubdomain(subdomain.toLowerCase());
    if (!organization) {
      throw new NotFoundException('No office is registered at this address');
    }
    return {
      id: organization.id,
      legalName: organization.legalName,
      legalNameAr: organization.legalNameAr,
      subdomain: organization.subdomain,
      status: organization.status,
    };
  }

  /** Kept so the repository stays the single owner of Organization reads by
   * id, which the per-Organization job runner also uses. */
  findById(id: string) {
    return this.organizations.findById(id);
  }
}
