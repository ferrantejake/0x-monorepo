import { BlockchainLifecycle } from '@0xproject/dev-utils';
import { BigNumber, NULL_BYTES } from '@0xproject/utils';
import * as chai from 'chai';
import ethUtil = require('ethereumjs-util');
import * as _ from 'lodash';

import { TokenRegistryContract } from '../generated_contract_wrappers/token_registry';

import { artifacts } from './utils/artifacts';
import { expectRevertOrAlwaysFailingTransactionAsync } from './utils/assertions';
import { chaiSetup } from './utils/chai_setup';
import { constants } from './utils/constants';
import { TokenRegWrapper } from './utils/token_registry_wrapper';
import { provider, txDefaults, web3Wrapper } from './utils/web3_wrapper';

chaiSetup.configure();
const expect = chai.expect;
const blockchainLifecycle = new BlockchainLifecycle(web3Wrapper);

describe('TokenRegistry', () => {
    let owner: string;
    let notOwner: string;
    let tokenReg: TokenRegistryContract;
    let tokenRegWrapper: TokenRegWrapper;

    before(async () => {
        await blockchainLifecycle.startAsync();
    });
    after(async () => {
        await blockchainLifecycle.revertAsync();
    });
    before(async () => {
        const accounts = await web3Wrapper.getAvailableAddressesAsync();
        owner = accounts[0];
        notOwner = accounts[1];
        tokenReg = await TokenRegistryContract.deployFrom0xArtifactAsync(artifacts.TokenRegistry, provider, txDefaults);
        tokenRegWrapper = new TokenRegWrapper(tokenReg, provider);
    });
    beforeEach(async () => {
        await blockchainLifecycle.startAsync();
    });
    afterEach(async () => {
        await blockchainLifecycle.revertAsync();
    });

    const tokenAddress1 = `0x${ethUtil.setLength(ethUtil.toBuffer('0x1'), 20, false).toString('hex')}`;
    const tokenAddress2 = `0x${ethUtil.setLength(ethUtil.toBuffer('0x2'), 20, false).toString('hex')}`;

    const token1 = {
        address: tokenAddress1,
        name: 'testToken1',
        symbol: 'TT1',
        decimals: 18,
        ipfsHash: `0x${ethUtil.sha3('ipfs1').toString('hex')}`,
        swarmHash: `0x${ethUtil.sha3('swarm1').toString('hex')}`,
    };

    const token2 = {
        address: tokenAddress2,
        name: 'testToken2',
        symbol: 'TT2',
        decimals: 18,
        ipfsHash: `0x${ethUtil.sha3('ipfs2').toString('hex')}`,
        swarmHash: `0x${ethUtil.sha3('swarm2').toString('hex')}`,
    };

    const nullToken = {
        address: constants.NULL_ADDRESS,
        name: '',
        symbol: '',
        decimals: 0,
        ipfsHash: NULL_BYTES,
        swarmHash: NULL_BYTES,
    };

    describe('addToken', () => {
        it('should throw when not called by owner', async () => {
            return expectRevertOrAlwaysFailingTransactionAsync(tokenRegWrapper.addTokenAsync(token1, notOwner));
        });

        it('should add token metadata when called by owner', async () => {
            await tokenRegWrapper.addTokenAsync(token1, owner);
            const tokenData = await tokenRegWrapper.getTokenMetaDataAsync(token1.address);
            expect(tokenData).to.be.deep.equal(token1);
        });

        it('should throw if token already exists', async () => {
            await tokenRegWrapper.addTokenAsync(token1, owner);

            return expectRevertOrAlwaysFailingTransactionAsync(tokenRegWrapper.addTokenAsync(token1, owner));
        });

        it('should throw if token address is null', async () => {
            return expectRevertOrAlwaysFailingTransactionAsync(tokenRegWrapper.addTokenAsync(nullToken, owner));
        });

        it('should throw if name already exists', async () => {
            await tokenRegWrapper.addTokenAsync(token1, owner);
            const duplicateNameToken = _.assign({}, token2, { name: token1.name });

            return expectRevertOrAlwaysFailingTransactionAsync(
                tokenRegWrapper.addTokenAsync(duplicateNameToken, owner),
            );
        });

        it('should throw if symbol already exists', async () => {
            await tokenRegWrapper.addTokenAsync(token1, owner);
            const duplicateSymbolToken = _.assign({}, token2, {
                symbol: token1.symbol,
            });

            return expectRevertOrAlwaysFailingTransactionAsync(
                tokenRegWrapper.addTokenAsync(duplicateSymbolToken, owner),
            );
        });
    });

    describe('after addToken', () => {
        beforeEach(async () => {
            await tokenRegWrapper.addTokenAsync(token1, owner);
        });

        describe('getTokenByName', () => {
            it('should return token metadata when given the token name', async () => {
                const tokenData = await tokenRegWrapper.getTokenByNameAsync(token1.name);
                expect(tokenData).to.be.deep.equal(token1);
            });
        });

        describe('getTokenBySymbol', () => {
            it('should return token metadata when given the token symbol', async () => {
                const tokenData = await tokenRegWrapper.getTokenBySymbolAsync(token1.symbol);
                expect(tokenData).to.be.deep.equal(token1);
            });
        });

        describe('setTokenName', () => {
            it('should throw when not called by owner', async () => {
                return expectRevertOrAlwaysFailingTransactionAsync(
                    tokenReg.setTokenName.sendTransactionAsync(token1.address, token2.name, { from: notOwner }),
                );
            });

            it('should change the token name when called by owner', async () => {
                await web3Wrapper.awaitTransactionSuccessAsync(
                    await tokenReg.setTokenName.sendTransactionAsync(token1.address, token2.name, {
                        from: owner,
                    }),
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                const [newData, oldData] = await Promise.all([
                    tokenRegWrapper.getTokenByNameAsync(token2.name),
                    tokenRegWrapper.getTokenByNameAsync(token1.name),
                ]);

                const expectedNewData = _.assign({}, token1, { name: token2.name });
                const expectedOldData = nullToken;
                expect(newData).to.be.deep.equal(expectedNewData);
                expect(oldData).to.be.deep.equal(expectedOldData);
            });

            it('should throw if the name already exists', async () => {
                await tokenRegWrapper.addTokenAsync(token2, owner);

                return expectRevertOrAlwaysFailingTransactionAsync(
                    tokenReg.setTokenName.sendTransactionAsync(token1.address, token2.name, { from: owner }),
                );
            });

            it('should throw if token does not exist', async () => {
                return expectRevertOrAlwaysFailingTransactionAsync(
                    tokenReg.setTokenName.sendTransactionAsync(nullToken.address, token2.name, { from: owner }),
                );
            });
        });

        describe('setTokenSymbol', () => {
            it('should throw when not called by owner', async () => {
                return expectRevertOrAlwaysFailingTransactionAsync(
                    tokenReg.setTokenSymbol.sendTransactionAsync(token1.address, token2.symbol, {
                        from: notOwner,
                    }),
                );
            });

            it('should change the token symbol when called by owner', async () => {
                await web3Wrapper.awaitTransactionSuccessAsync(
                    await tokenReg.setTokenSymbol.sendTransactionAsync(token1.address, token2.symbol, { from: owner }),
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                const [newData, oldData] = await Promise.all([
                    tokenRegWrapper.getTokenBySymbolAsync(token2.symbol),
                    tokenRegWrapper.getTokenBySymbolAsync(token1.symbol),
                ]);

                const expectedNewData = _.assign({}, token1, { symbol: token2.symbol });
                const expectedOldData = nullToken;
                expect(newData).to.be.deep.equal(expectedNewData);
                expect(oldData).to.be.deep.equal(expectedOldData);
            });

            it('should throw if the symbol already exists', async () => {
                await tokenRegWrapper.addTokenAsync(token2, owner);

                return expectRevertOrAlwaysFailingTransactionAsync(
                    tokenReg.setTokenSymbol.sendTransactionAsync(token1.address, token2.symbol, {
                        from: owner,
                    }),
                );
            });

            it('should throw if token does not exist', async () => {
                return expectRevertOrAlwaysFailingTransactionAsync(
                    tokenReg.setTokenSymbol.sendTransactionAsync(nullToken.address, token2.symbol, {
                        from: owner,
                    }),
                );
            });
        });

        describe('removeToken', () => {
            it('should throw if not called by owner', async () => {
                const index = new BigNumber(0);
                return expectRevertOrAlwaysFailingTransactionAsync(
                    tokenReg.removeToken.sendTransactionAsync(token1.address, index, { from: notOwner }),
                );
            });

            it('should remove token metadata when called by owner', async () => {
                const index = new BigNumber(0);
                await web3Wrapper.awaitTransactionSuccessAsync(
                    await tokenReg.removeToken.sendTransactionAsync(token1.address, index, {
                        from: owner,
                    }),
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                const tokenData = await tokenRegWrapper.getTokenMetaDataAsync(token1.address);
                expect(tokenData).to.be.deep.equal(nullToken);
            });

            it('should throw if token does not exist', async () => {
                const index = new BigNumber(0);
                return expectRevertOrAlwaysFailingTransactionAsync(
                    tokenReg.removeToken.sendTransactionAsync(nullToken.address, index, { from: owner }),
                );
            });

            it('should throw if token at given index does not match address', async () => {
                await tokenRegWrapper.addTokenAsync(token2, owner);
                const incorrectIndex = new BigNumber(0);
                return expectRevertOrAlwaysFailingTransactionAsync(
                    tokenReg.removeToken.sendTransactionAsync(token2.address, incorrectIndex, { from: owner }),
                );
            });
        });
    });
});
