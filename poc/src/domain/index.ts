import { Asset } from 'stellar-sdk'
import { config } from 'dotenv'
import { NoVaultsError, ValidatorNotRegisteredError } from './errors'

config()

export class Controller {
    constructor(public vaults: Vault[] = [], public mints: Mint[] = []) {}

    static getSolanaMintAttributeName(asset: Asset) {
        return `w${asset.getCode() || 'xlm'}_mint`
    }

    addValidator(validator: Validator): Vault {
        if (this.vaults.length === 0) {
            throw new NoVaultsError()
        }

        this.vaults[0].validators.push(validator)
        return this.vaults[0]
    }

    addValidatorToMint(validator: Validator, mint: Mint) {
        const validators = this.vaults.map((vault) => vault.validators).flat()
        const isValidatorInVault = validators.some((v) => v.stellarPublicKey === validator.stellarPublicKey)

        if (!isValidatorInVault) {
            throw new ValidatorNotRegisteredError()
        }

        // other checks
    }

    lockStellarAsset(asset: Asset, amount: string): Vault {
        // select vault(s), for this POC only 1 vault is returned
        return this.vaults[0]
    }

    mintWrappedAsset(): Vault {
        // select vault(s), for this POC only 1 vault is returned
        // by passing in the etxa we can derive the vault from the etxa signature
        return this.vaults[0]
    }
}

export class Validator {
    constructor(public stellarPublicKey: string, public solanaPublicKey: string) {}
}

export class Vault {
    constructor(public publicKey: string, public validators: Validator[]) {}
}

export class Mint {
    constructor(public mintPublicKey: string, public authority: string, public validators: Validator[]) {}
}

export class User {
    constructor(public stellarPublicKey: string, public solanaPublicKey: string) {}
}
