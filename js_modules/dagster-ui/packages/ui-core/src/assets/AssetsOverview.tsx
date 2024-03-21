import {useQuery} from '@apollo/client';
import {Box, Colors, Heading, Icon, MiddleTruncate, Page, Spinner} from '@dagster-io/ui-components';
import qs from 'qs';
import {useContext} from 'react';
import {Link, useParams} from 'react-router-dom';
import styled from 'styled-components';

import {AssetGlobalLineageButton, AssetPageHeader} from './AssetPageHeader';
import {ASSET_CATALOG_TABLE_QUERY} from './AssetsCatalogTable';
import {fetchRecentlyVisitedAssetsFromLocalStorage} from './RecentlyVisitedAssetsStorage';
import {AssetTableDefinitionFragment} from './types/AssetTableFragment.types';
import {
  AssetCatalogTableQuery,
  AssetCatalogTableQueryVariables,
} from './types/AssetsCatalogTable.types';
import {COMMON_COLLATOR} from '../app/Util';
import {useTrackPageView} from '../app/analytics';
import {TimeContext} from '../app/time/TimeContext';
import {browserTimezone} from '../app/time/browserTimezone';
import {displayNameForAssetKey} from '../asset-graph/Utils';
import {TagIcon} from '../graph/OpTags';
import {useDocumentTitle} from '../hooks/useDocumentTitle';
import {useLaunchPadHooks} from '../launchpad/LaunchpadHooksContext';
import {AssetSearch} from '../search/AssetSearch';
import {AnchorButton} from '../ui/AnchorButton';
import {ReloadAllButton} from '../workspace/ReloadAllButton';
import {buildRepoPathForHuman} from '../workspace/buildRepoAddress';
import {repoAddressAsHumanString, repoAddressAsURLString} from '../workspace/repoAddressAsString';
import {repoAddressFromPath} from '../workspace/repoAddressFromPath';
import {RepoAddress} from '../workspace/types';

type AssetCountsResult = {
  countsByOwner: CountByOwner[];
  countsByComputeKind: CountByComputeKind[];
  countPerAssetGroup: CountPerGroupName[];
  countPerCodeLocation: CountPerCodeLocation[];
};

export type GroupMetadata = {
  groupName: string;
  repositoryLocationName: string;
  repositoryName: string;
};

type CountByOwner = {
  owner: string;
  assetCount: number;
};

type CountByComputeKind = {
  computeKind: string;
  assetCount: number;
};

type CountPerGroupName = {
  assetCount: number;
  groupMetadata: GroupMetadata;
};

type CountPerCodeLocation = {
  repoAddress: RepoAddress;
  assetCount: number;
};

type AssetDefinitionMetadata = {
  definition: Pick<
    AssetTableDefinitionFragment,
    'owners' | 'computeKind' | 'groupName' | 'repository'
  > | null;
};

export function buildAssetCountBySection(assets: AssetDefinitionMetadata[]): AssetCountsResult {
  const assetCountByOwner: Record<string, number> = {};
  const assetCountByComputeKind: Record<string, number> = {};
  const assetCountByGroup: Record<string, number> = {};
  const assetCountByCodeLocation: Record<string, number> = {};

  assets
    .filter((asset) => asset.definition)
    .forEach((asset) => {
      const assetDefinition = asset.definition!;
      assetDefinition.owners.forEach((owner) => {
        const ownerKey = owner.__typename === 'UserAssetOwner' ? owner.email : owner.team;
        assetCountByOwner[ownerKey] = (assetCountByOwner[ownerKey] || 0) + 1;
      });

      const computeKind = assetDefinition.computeKind;
      if (computeKind) {
        assetCountByComputeKind[computeKind] = (assetCountByComputeKind[computeKind] || 0) + 1;
      }

      const groupName = assetDefinition.groupName;
      const locationName = assetDefinition.repository.location.name;
      const repositoryName = assetDefinition.repository.name;

      if (groupName) {
        const metadata: GroupMetadata = {
          groupName,
          repositoryLocationName: locationName,
          repositoryName,
        };
        const groupIdentifier = JSON.stringify(metadata);
        assetCountByGroup[groupIdentifier] = (assetCountByGroup[groupIdentifier] || 0) + 1;
      }

      const stringifiedCodeLocation = buildRepoPathForHuman(repositoryName, locationName);
      assetCountByCodeLocation[stringifiedCodeLocation] =
        (assetCountByCodeLocation[stringifiedCodeLocation] || 0) + 1;
    });

  const countsByOwner = Object.entries(assetCountByOwner)
    .map(([owner, count]) => ({
      owner,
      assetCount: count,
    }))
    .sort(({owner: ownerA}, {owner: ownerB}) => COMMON_COLLATOR.compare(ownerA, ownerB));
  const countsByComputeKind = Object.entries(assetCountByComputeKind)
    .map(([computeKind, count]) => ({
      computeKind,
      assetCount: count,
    }))
    .sort(({computeKind: computeKindA}, {computeKind: computeKindB}) =>
      COMMON_COLLATOR.compare(computeKindA, computeKindB),
    );
  const countPerAssetGroup = Object.entries(assetCountByGroup)
    .map(([groupIdentifier, count]) => ({
      assetCount: count,
      groupMetadata: JSON.parse(groupIdentifier),
    }))
    .sort(
      ({groupMetadata: groupMetadataA}, {groupMetadata: groupMetadataB}) =>
        COMMON_COLLATOR.compare(
          repoAddressAsHumanString({
            name: groupMetadataA.repositoryName,
            location: groupMetadataA.repositoryLocationName,
          }),
          repoAddressAsHumanString({
            name: groupMetadataB.repositoryName,
            location: groupMetadataB.repositoryLocationName,
          }),
        ) || COMMON_COLLATOR.compare(groupMetadataA.groupName, groupMetadataB.groupName),
    );
  const countPerCodeLocation = Object.entries(assetCountByCodeLocation)
    .map(([key, count]) => ({
      repoAddress: repoAddressFromPath(key)!,
      assetCount: count,
    }))
    .sort(({repoAddress: repoAddressA}, {repoAddress: repoAddressB}) =>
      COMMON_COLLATOR.compare(
        repoAddressAsHumanString(repoAddressA),
        repoAddressAsHumanString(repoAddressB),
      ),
    );

  return {
    countsByOwner,
    countsByComputeKind,
    countPerAssetGroup,
    countPerCodeLocation,
  };
}

interface AssetOverviewCategoryProps {
  children: React.ReactNode;
  assetsCount: number;
  link: string;
  showCount?: boolean;
}

function getGreeting(timezone: string) {
  const hour = Number(
    new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone === 'Automatic' ? browserTimezone() : timezone,
    }),
  );
  if (hour < 4) {
    return 'Good evening';
  } else if (hour < 12) {
    return 'Good morning';
  } else if (hour < 18) {
    return 'Good afternoon';
  } else {
    return 'Good evening';
  }
}

function assetCountString(count: number) {
  return count === 1 ? '1 asset' : `${count} assets`;
}

const CountForAssetType = ({
  children,
  assetsCount,
  link,
  showCount = true,
}: AssetOverviewCategoryProps) => {
  return (
    <Link to={link} style={{textDecoration: 'none'}}>
      <GridItem>
        <Box flex={{direction: 'row', alignItems: 'center', gap: 4}} style={{overflow: 'hidden'}}>
          {children}
        </Box>
        <span
          style={{
            ...TextOverflowStyle,
            ...{
              color: Colors.textLight(),
              fontSize: '14px',
              textAlign: 'right',
            },
          }}
        >
          {showCount && assetCountString(assetsCount)}
        </span>
      </GridItem>
    </Link>
  );
};

const SectionHeader = ({sectionName}: {sectionName: string}) => {
  return (
    <Box
      flex={{alignItems: 'center', justifyContent: 'space-between'}}
      padding={{horizontal: 24, vertical: 8}}
      border="top-and-bottom"
    >
      <SectionName>{sectionName}</SectionName>
    </Box>
  );
};

const linkToAssetGraphGroup = (groupMetadata: GroupMetadata) => {
  return `/asset-groups?${qs.stringify({groups: JSON.stringify([groupMetadata])})}`;
};

const linkToAssetGraphOwner = (owner: string) => {
  return `/asset-groups?${qs.stringify({owners: JSON.stringify([owner])})}`;
};

const linkToAssetGraphComputeKind = (computeKind: string) => {
  return `/asset-groups?${qs.stringify({
    computeKindTags: JSON.stringify([computeKind]),
  })}`;
};

export const linkToCodeLocation = (repoAddress: RepoAddress) => {
  return `/locations/${repoAddressAsURLString(repoAddress)}/assets`;
};

export const AssetsOverview = ({viewerName}: {viewerName?: string}) => {
  useTrackPageView();

  const params = useParams();
  const currentPath: string[] = ((params as any)['0'] || '')
    .split('/')
    .filter((x: string) => x)
    .map(decodeURIComponent);

  useDocumentTitle('Assets');

  const assetsQuery = useQuery<AssetCatalogTableQuery, AssetCatalogTableQueryVariables>(
    ASSET_CATALOG_TABLE_QUERY,
    {
      notifyOnNetworkStatusChange: true,
    },
  );
  const assetCountBySection = buildAssetCountBySection(
    assetsQuery.data?.assetsOrError.__typename === 'AssetConnection'
      ? assetsQuery.data.assetsOrError.nodes
      : [],
  );
  const {UserDisplay} = useLaunchPadHooks();
  const {
    timezone: [timezone],
  } = useContext(TimeContext);
  const recentlyVisitedAssets = fetchRecentlyVisitedAssetsFromLocalStorage();
  const viewerFirstName = viewerName?.split(' ')[0];

  if (assetsQuery.loading) {
    return (
      <Page>
        <AssetPageHeader assetKey={{path: currentPath}} />
        <Box flex={{direction: 'row', justifyContent: 'center'}} style={{paddingTop: '100px'}}>
          <Box flex={{direction: 'row', alignItems: 'center', gap: 16}}>
            <Spinner purpose="body-text" />
            <div style={{color: Colors.textLight()}}>Loading assets…</div>
          </Box>
        </Box>
      </Page>
    );
  }

  return (
    <Box flex={{direction: 'column'}} style={{height: '100%'}}>
      <AssetPageHeader
        assetKey={{path: currentPath}}
        right={<ReloadAllButton label="Reload definitions" />}
      />
      <Box flex={{direction: 'column'}} style={{height: '100%', overflow: 'auto'}}>
        <Box
          padding={64}
          flex={{justifyContent: 'center', alignItems: 'center'}}
          style={{
            background: Colors.blueGradient(),
          }}
        >
          <Box style={{width: '60%', minWidth: '600px'}} flex={{direction: 'column', gap: 16}}>
            <Box flex={{direction: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
              <Heading>
                {getGreeting(timezone)}
                {viewerFirstName ? `, ${viewerFirstName}` : ''}
              </Heading>
              <Box flex={{direction: 'row', alignItems: 'center', gap: 6}}>
                <AnchorButton intent="primary" outlined to="/assets">
                  View all assets
                </AnchorButton>
                <AssetGlobalLineageButton />
              </Box>
            </Box>
            <AssetSearch />
          </Box>
        </Box>
        <Box flex={{direction: 'column'}}>
          {recentlyVisitedAssets.length > 0 && (
            <>
              <SectionHeader sectionName="Recently visited" />
              <GridStyle>
                {recentlyVisitedAssets.map((assetKey, idx) => (
                  <CountForAssetType
                    key={idx}
                    assetsCount={0}
                    link={`/assets/${assetKey.path.join('/')}`}
                    showCount={false}
                  >
                    <Icon name="asset" />
                    <span style={TextOverflowStyle}>{displayNameForAssetKey(assetKey)}</span>
                  </CountForAssetType>
                ))}
              </GridStyle>
            </>
          )}
          {Object.keys(assetCountBySection.countsByOwner).length > 0 && (
            <>
              <SectionHeader sectionName="Owners" />
              <GridStyle>
                {assetCountBySection.countsByOwner.map(({owner, assetCount}) => (
                  <CountForAssetType
                    key={owner}
                    assetsCount={assetCount}
                    link={linkToAssetGraphOwner(owner)}
                  >
                    <span style={TextOverflowStyle}>
                      <UserDisplay email={owner} />
                    </span>
                  </CountForAssetType>
                ))}
              </GridStyle>
            </>
          )}
          {Object.keys(assetCountBySection.countsByComputeKind).length > 0 && (
            <>
              <SectionHeader sectionName="Compute kinds" />
              <GridStyle>
                {assetCountBySection.countsByComputeKind.map(({computeKind, assetCount}) => (
                  <CountForAssetType
                    key={computeKind}
                    assetsCount={assetCount}
                    link={linkToAssetGraphComputeKind(computeKind)}
                  >
                    <TagIcon label={computeKind} />
                    <span style={TextOverflowStyle}>{computeKind}</span>
                  </CountForAssetType>
                ))}
              </GridStyle>
            </>
          )}
          {assetCountBySection.countPerAssetGroup.length > 0 && (
            <>
              <SectionHeader sectionName="Asset groups" />
              <GridStyle>
                {assetCountBySection.countPerAssetGroup.map((assetGroupCount) => (
                  <CountForAssetType
                    key={JSON.stringify(assetGroupCount.groupMetadata)}
                    assetsCount={assetGroupCount.assetCount}
                    link={linkToAssetGraphGroup(assetGroupCount.groupMetadata)}
                  >
                    <Icon name="asset_group" />
                    <span style={TextOverflowStyle}>{assetGroupCount.groupMetadata.groupName}</span>
                    <MiddleTruncate
                      text={repoAddressAsHumanString({
                        name: assetGroupCount.groupMetadata.repositoryName,
                        location: assetGroupCount.groupMetadata.repositoryLocationName,
                      })}
                    />
                  </CountForAssetType>
                ))}
              </GridStyle>
            </>
          )}
          {assetCountBySection.countPerCodeLocation.length > 0 && (
            <>
              <SectionHeader sectionName="Code locations" />
              <GridStyle>
                {assetCountBySection.countPerCodeLocation.map((countPerCodeLocation) => (
                  <CountForAssetType
                    key={repoAddressAsHumanString(countPerCodeLocation.repoAddress)}
                    assetsCount={countPerCodeLocation.assetCount}
                    link={linkToCodeLocation(countPerCodeLocation.repoAddress)}
                  >
                    <Icon name="folder" />
                    <span style={TextOverflowStyle}>
                      {repoAddressAsHumanString(countPerCodeLocation.repoAddress)}
                    </span>
                  </CountForAssetType>
                ))}
              </GridStyle>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
};

// Imported via React.lazy, which requires a default export.
// eslint-disable-next-line import/no-default-export
export default AssetsOverview;

const SectionName = styled.span`
  font-weight: 600;
  color: ${Colors.textLight()};
  font-size: 12px;
`;

const TextOverflowStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const GridStyle = styled.div`
  padding: 16px 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const GridItem = styled.div`
  padding: 6px 12px;
  display: flex;
  justify-content: space-between;
  background: transparent;
  transition:
    color 0.3s,
    background 0.3s;
  border-radius: 6px;
  text-decoration: none;
  color: ${Colors.textLight()};
  & > span {
    color: ${Colors.textLight()};
    opacity: 0;
    transition: opacity 0.3s;
  }
  :hover {
    background: ${Colors.backgroundLightHover()};
    color: ${Colors.textDefault()};
    & > span {
      opacity: 1;
    }
  }
`;