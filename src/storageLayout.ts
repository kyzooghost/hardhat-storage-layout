import fs from "fs";
import { HardhatPluginError } from "hardhat/plugins";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import path from "path";

import { Prettify } from "./prettifier";
import "./type-extensions";
import { Row, Table } from "./types";

export class StorageLayout {
  public env: HardhatRuntimeEnvironment;

  constructor(hre: HardhatRuntimeEnvironment) {
    this.env = hre;
  }

  public async export() {
    const storageLayoutPath = this.env.config.paths.newStorageLayoutPath;
    const outputDirectory = path.resolve(storageLayoutPath);
    if (!outputDirectory.startsWith(this.env.config.paths.root)) {
      throw new HardhatPluginError(
        "output directory should be inside the project directory"
      );
    }
    if (!fs.existsSync(outputDirectory)) {
      fs.mkdirSync(outputDirectory);
    }

    const buildInfos = await this.env.artifacts.getBuildInfoPaths();
    const artifactsPath = this.env.config.paths.artifacts;
    const artifacts = buildInfos.map((source, idx) => {
      const artifact: Buffer = fs.readFileSync(source);
      return {
        idx,
        source: source.startsWith(artifactsPath)
          ? source.slice(artifactsPath.length)
          : source,
        data: JSON.parse(artifact.toString())
      };
    });

    const names: Array<{ sourceName: string; contractName: string }> = [];
    for (const fullName of await this.env.artifacts.getAllFullyQualifiedNames()) {
      const {
        sourceName,
        contractName
      } = await this.env.artifacts.readArtifact(fullName);
      names.push({ sourceName, contractName });
    }
    /*
      Example element in `names`
      {
        sourceName: '@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol',
        contractName: 'ERC165Upgradeable'
      },
    */  
    names.sort((a, b) => a.contractName.localeCompare(b.contractName));

    const data: Table = { contracts: [] };
    for (const artifactJsonABI of artifacts) {
      // First pass to get astIds (in this artifactJson) of all @openzeppelin/contracts-upgradeable storage slots
      const openZeppelinContractsUpgradeableStorageSlotAstIds = new Set();
      for (const { sourceName, contractName } of names) {
        if (!sourceName.startsWith("@openzeppelin/contracts-upgradeable")) continue;
        const storage =
          artifactJsonABI.data.output?.contracts?.[sourceName]?.[contractName]
            ?.storageLayout?.storage;
        if (!storage) continue;
        for (const stateVariable of storage) {
          openZeppelinContractsUpgradeableStorageSlotAstIds.add(stateVariable.astId)
        }
      }

      // Second pass to get relevant storage slots
      for (const { sourceName, contractName } of names) {
        // Ignore OpenZeppelin contracts
        if (sourceName.startsWith("@openzeppelin")) continue;
        const storage =
          artifactJsonABI.data.output?.contracts?.[sourceName]?.[contractName]
            ?.storageLayout?.storage;
        if (!storage) continue;
        const contract: Row = { name: contractName, stateVariables: [] };
        for (const stateVariable of storage) {
          // Skip and do not include @openzeppelin/contracts-upgradeable storage slots
          if (openZeppelinContractsUpgradeableStorageSlotAstIds.has(stateVariable.astId)) continue;
          contract.stateVariables.push({
            name: stateVariable.label,
            slot: stateVariable.slot,
            offset: stateVariable.offset,
            type: stateVariable.type,
            source: sourceName,
            numberOfBytes:
              artifactJsonABI.data.output?.contracts[sourceName][contractName]
                .storageLayout.types[stateVariable.type].numberOfBytes
          });
        }
        data.contracts.push(contract);
      }
    }
    fs.writeFileSync(path.join(outputDirectory, "output.json"), JSON.stringify(data.contracts, null, 2));
    const prettifier = new Prettify(data.contracts);
    prettifier.tabulate();
  }
}
