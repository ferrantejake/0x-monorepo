import { BlockchainLifecycle } from '@0xproject/dev-utils';
import { assetProxyUtils } from '@0xproject/order-utils';
import { AssetProxyId, SignedOrder } from '@0xproject/types';
import { BigNumber } from '@0xproject/utils';
import { Web3Wrapper } from '@0xproject/web3-wrapper';
import * as chai from 'chai';
import { TransactionReceiptWithDecodedLogs } from 'ethereum-types';

import { DummyERC20TokenContract } from '../../src/generated_contract_wrappers/dummy_e_r_c20_token';
import { DummyERC721TokenContract } from '../../src/generated_contract_wrappers/dummy_e_r_c721_token';
import { ERC20ProxyContract } from '../../src/generated_contract_wrappers/e_r_c20_proxy';
import { ERC721ProxyContract } from '../../src/generated_contract_wrappers/e_r_c721_proxy';
import { ExchangeContract } from '../../src/generated_contract_wrappers/exchange';
import { ForwarderContract } from '../../src/generated_contract_wrappers/forwarder';
import { WETH9Contract } from '../../src/generated_contract_wrappers/weth9';
import { artifacts } from '../../src/utils/artifacts';
import { expectRevertOrAlwaysFailingTransactionAsync } from '../../src/utils/assertions';
import { chaiSetup } from '../../src/utils/chai_setup';
import { constants } from '../../src/utils/constants';
import { ERC20Wrapper } from '../../src/utils/erc20_wrapper';
import { ERC721Wrapper } from '../../src/utils/erc721_wrapper';
import { ExchangeWrapper } from '../../src/utils/exchange_wrapper';
import { formatters } from '../../src/utils/formatters';
import { ForwarderWrapper } from '../../src/utils/forwarder_wrapper';
import { OrderFactory } from '../../src/utils/order_factory';
import { ContractName, ERC20BalancesByOwner } from '../../src/utils/types';
import { provider, txDefaults, web3Wrapper } from '../../src/utils/web3_wrapper';

chaiSetup.configure();
const expect = chai.expect;
const blockchainLifecycle = new BlockchainLifecycle(web3Wrapper);
const DECIMALS_DEFAULT = 18;

describe(ContractName.Forwarder, () => {
    let makerAddress: string;
    let owner: string;
    let takerAddress: string;
    let feeRecipientAddress: string;
    let defaultTakerAssetAddress: string;
    let defaultMakerAssetAddress: string;

    let weth: DummyERC20TokenContract;
    let erc20TokenA: DummyERC20TokenContract;
    let erc20TokenB: DummyERC20TokenContract;
    let zrxToken: DummyERC20TokenContract;
    let erc721Token: DummyERC721TokenContract;
    let forwarderContract: ForwarderContract;
    let wethContract: WETH9Contract;
    let forwarderWrapper: ForwarderWrapper;
    let erc20Proxy: ERC20ProxyContract;
    let erc721Proxy: ERC721ProxyContract;

    let signedOrder: SignedOrder;
    let signedOrders: SignedOrder[];
    let orderWithFee: SignedOrder;
    let signedOrdersWithFee: SignedOrder[];
    let feeOrder: SignedOrder;
    let feeOrders: SignedOrder[];
    let orderFactory: OrderFactory;
    let erc20Wrapper: ERC20Wrapper;
    let erc721Wrapper: ERC721Wrapper;
    let erc20Balances: ERC20BalancesByOwner;
    let tx: TransactionReceiptWithDecodedLogs;

    let erc721MakerAssetIds: BigNumber[];
    let feeProportion: number = 0;

    before(async () => {
        await blockchainLifecycle.startAsync();
        const accounts = await web3Wrapper.getAvailableAddressesAsync();
        const usedAddresses = ([owner, makerAddress, takerAddress, feeRecipientAddress] = accounts);

        erc20Wrapper = new ERC20Wrapper(provider, usedAddresses, owner);
        erc721Wrapper = new ERC721Wrapper(provider, usedAddresses, owner);

        [erc20TokenA, erc20TokenB, zrxToken] = await erc20Wrapper.deployDummyTokensAsync();
        erc20Proxy = await erc20Wrapper.deployProxyAsync();
        await erc20Wrapper.setBalancesAndAllowancesAsync();

        [erc721Token] = await erc721Wrapper.deployDummyTokensAsync();
        erc721Proxy = await erc721Wrapper.deployProxyAsync();
        await erc721Wrapper.setBalancesAndAllowancesAsync();
        const erc721Balances = await erc721Wrapper.getBalancesAsync();
        erc721MakerAssetIds = erc721Balances[makerAddress][erc721Token.address];

        wethContract = await WETH9Contract.deployFrom0xArtifactAsync(artifacts.EtherToken, provider, txDefaults);
        weth = new DummyERC20TokenContract(wethContract.abi, wethContract.address, provider);
        erc20Wrapper.addDummyTokenContract(weth);

        const wethAssetData = assetProxyUtils.encodeERC20AssetData(wethContract.address);
        const zrxAssetData = assetProxyUtils.encodeERC20AssetData(zrxToken.address);
        const exchangeInstance = await ExchangeContract.deployFrom0xArtifactAsync(
            artifacts.Exchange,
            provider,
            txDefaults,
            zrxAssetData,
        );
        const exchange = new ExchangeContract(exchangeInstance.abi, exchangeInstance.address, provider);
        const exchangeWrapper = new ExchangeWrapper(exchange, provider);
        await exchangeWrapper.registerAssetProxyAsync(AssetProxyId.ERC20, erc20Proxy.address, owner);
        await exchangeWrapper.registerAssetProxyAsync(AssetProxyId.ERC721, erc721Proxy.address, owner);

        await erc20Proxy.addAuthorizedAddress.sendTransactionAsync(exchangeInstance.address, {
            from: owner,
        });
        await erc721Proxy.addAuthorizedAddress.sendTransactionAsync(exchangeInstance.address, {
            from: owner,
        });

        defaultMakerAssetAddress = erc20TokenA.address;
        defaultTakerAssetAddress = wethContract.address;
        const defaultOrderParams = {
            exchangeAddress: exchangeInstance.address,
            makerAddress,
            feeRecipientAddress,
            makerAssetData: assetProxyUtils.encodeERC20AssetData(defaultMakerAssetAddress),
            takerAssetData: assetProxyUtils.encodeERC20AssetData(defaultTakerAssetAddress),
            makerAssetAmount: Web3Wrapper.toBaseUnitAmount(new BigNumber(200), DECIMALS_DEFAULT),
            takerAssetAmount: Web3Wrapper.toBaseUnitAmount(new BigNumber(10), DECIMALS_DEFAULT),
            makerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(1), DECIMALS_DEFAULT),
            takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(0), DECIMALS_DEFAULT),
        };
        const privateKey = constants.TESTRPC_PRIVATE_KEYS[accounts.indexOf(makerAddress)];
        orderFactory = new OrderFactory(privateKey, defaultOrderParams);

        const forwarderInstance = await ForwarderContract.deployFrom0xArtifactAsync(
            artifacts.Forwarder,
            provider,
            txDefaults,
            exchangeInstance.address,
            wethContract.address,
            zrxToken.address,
            AssetProxyId.ERC20,
            zrxAssetData,
            wethAssetData,
        );
        forwarderContract = new ForwarderContract(forwarderInstance.abi, forwarderInstance.address, provider);
        forwarderWrapper = new ForwarderWrapper(forwarderContract, provider, zrxToken.address);
        erc20Wrapper.addTokenOwnerAddress(forwarderInstance.address);

        web3Wrapper.abiDecoder.addABI(forwarderContract.abi);
        web3Wrapper.abiDecoder.addABI(exchangeInstance.abi);
    });
    after(async () => {
        await blockchainLifecycle.revertAsync();
    });
    beforeEach(async () => {
        await blockchainLifecycle.startAsync();
        feeProportion = 0;
        erc20Balances = await erc20Wrapper.getBalancesAsync();
        signedOrder = orderFactory.newSignedOrder();
        signedOrders = [signedOrder];
        feeOrder = orderFactory.newSignedOrder({
            makerAssetData: assetProxyUtils.encodeERC20AssetData(zrxToken.address),
            takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(1), DECIMALS_DEFAULT),
        });
        feeOrders = [feeOrder];
        orderWithFee = orderFactory.newSignedOrder({
            takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(1), DECIMALS_DEFAULT),
        });
        signedOrdersWithFee = [orderWithFee];
    });
    afterEach(async () => {
        await blockchainLifecycle.revertAsync();
    });
    describe('marketBuyTokens', () => {
        it('should fill the order', async () => {
            const fillAmount = signedOrder.takerAssetAmount.div(2);
            const makerBalanceBefore = erc20Balances[makerAddress][defaultMakerAssetAddress];
            const takerBalanceBefore = erc20Balances[takerAddress][defaultMakerAssetAddress];
            feeOrders = [];
            tx = await forwarderWrapper.marketBuyTokensAsync(signedOrders, feeOrders, {
                value: fillAmount,
                from: takerAddress,
            });
            const newBalances = await erc20Wrapper.getBalancesAsync();
            const makerBalanceAfter = newBalances[makerAddress][defaultMakerAssetAddress];
            const takerBalanceAfter = newBalances[takerAddress][defaultMakerAssetAddress];
            const makerTokenFillAmount = fillAmount
                .times(signedOrder.makerAssetAmount)
                .dividedToIntegerBy(signedOrder.takerAssetAmount);

            expect(makerBalanceAfter).to.be.bignumber.equal(makerBalanceBefore.minus(makerTokenFillAmount));
            expect(takerBalanceAfter).to.be.bignumber.equal(takerBalanceBefore.plus(makerTokenFillAmount));
            expect(newBalances[forwarderContract.address][weth.address]).to.be.bignumber.equal(new BigNumber(0));
        });
        it('should fill the order and perform fee abstraction', async () => {
            const fillAmount = signedOrder.takerAssetAmount.div(4);
            const takerBalanceBefore = erc20Balances[takerAddress][defaultMakerAssetAddress];
            tx = await forwarderWrapper.marketBuyTokensAsync(signedOrdersWithFee, feeOrders, {
                value: fillAmount,
                from: takerAddress,
            });
            const newBalances = await erc20Wrapper.getBalancesAsync();
            const takerBalanceAfter = newBalances[takerAddress][defaultMakerAssetAddress];

            const acceptPercentage = 98;
            const acceptableThreshold = takerBalanceBefore.plus(fillAmount.times(acceptPercentage).dividedBy(100));
            const isWithinThreshold = takerBalanceAfter.greaterThanOrEqualTo(acceptableThreshold);
            expect(isWithinThreshold).to.be.true();
            expect(newBalances[forwarderContract.address][weth.address]).to.be.bignumber.equal(new BigNumber(0));
        });
        it('should fill the order when token is ZRX with fees', async () => {
            orderWithFee = orderFactory.newSignedOrder({
                makerAssetData: assetProxyUtils.encodeERC20AssetData(zrxToken.address),
                takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(1), DECIMALS_DEFAULT),
            });
            signedOrdersWithFee = [orderWithFee];
            feeOrders = [];
            const fillAmount = signedOrder.takerAssetAmount.div(4);
            const takerBalanceBefore = erc20Balances[takerAddress][zrxToken.address];
            tx = await forwarderWrapper.marketBuyTokensAsync(signedOrdersWithFee, feeOrders, {
                value: fillAmount,
                from: takerAddress,
            });
            const newBalances = await erc20Wrapper.getBalancesAsync();
            const takerBalanceAfter = newBalances[takerAddress][zrxToken.address];

            const acceptPercentage = 98;
            const acceptableThreshold = takerBalanceBefore.plus(fillAmount.times(acceptPercentage).dividedBy(100));
            const isWithinThreshold = takerBalanceAfter.greaterThanOrEqualTo(acceptableThreshold);
            expect(isWithinThreshold).to.be.true();
            expect(newBalances[forwarderContract.address][weth.address]).to.be.bignumber.equal(new BigNumber(0));
        });
        it('should fail if sent an ETH amount too high', async () => {
            signedOrder = orderFactory.newSignedOrder({
                makerAssetData: assetProxyUtils.encodeERC20AssetData(zrxToken.address),
                takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(1), DECIMALS_DEFAULT),
            });
            const fillAmount = signedOrder.takerAssetAmount.times(2);
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.marketBuyTokensAsync(signedOrdersWithFee, feeOrders, {
                    value: fillAmount,
                    from: takerAddress,
                }),
            );
        });
        it('should fail if fee abstraction amount is too high', async () => {
            orderWithFee = orderFactory.newSignedOrder({
                takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(50), DECIMALS_DEFAULT),
            });
            signedOrdersWithFee = [orderWithFee];
            feeOrder = orderFactory.newSignedOrder({
                makerAssetData: assetProxyUtils.encodeERC20AssetData(zrxToken.address),
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(new BigNumber(1), DECIMALS_DEFAULT),
            });
            feeOrders = [feeOrder];
            const fillAmount = signedOrder.takerAssetAmount.div(4);
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.marketBuyTokensAsync(signedOrdersWithFee, feeOrders, {
                    value: fillAmount,
                    from: takerAddress,
                }),
            );
        });
        it('throws when mixed ERC721 and ERC20 assets with ERC20 first', async () => {
            const makerAssetId = erc721MakerAssetIds[0];
            const erc721SignedOrder = orderFactory.newSignedOrder({
                makerAssetAmount: new BigNumber(1),
                makerAssetData: assetProxyUtils.encodeERC721AssetData(erc721Token.address, makerAssetId),
            });
            const erc20SignedOrder = orderFactory.newSignedOrder();
            signedOrders = [erc20SignedOrder, erc721SignedOrder];
            const fillAmountWei = erc20SignedOrder.takerAssetAmount.plus(erc721SignedOrder.takerAssetAmount);
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.marketBuyTokensAsync(signedOrders, feeOrders, {
                    from: takerAddress,
                    value: fillAmountWei,
                }),
            );
        });
    });
    describe('marketBuyTokensFee', () => {
        it('should fill the order and send fee to fee recipient', async () => {
            const initEthBalance = await web3Wrapper.getBalanceInWeiAsync(feeRecipientAddress);
            const fillAmount = signedOrder.takerAssetAmount.div(2);
            feeProportion = 150; // 1.5%
            feeOrders = [];
            tx = await forwarderWrapper.marketBuyTokensFeeAsync(
                signedOrders,
                feeOrders,
                feeProportion,
                feeRecipientAddress,
                {
                    from: takerAddress,
                    value: fillAmount,
                },
            );
            const newBalances = await erc20Wrapper.getBalancesAsync();
            const makerBalanceBefore = erc20Balances[makerAddress][defaultMakerAssetAddress];
            const makerBalanceAfter = newBalances[makerAddress][defaultMakerAssetAddress];
            const takerBalanceAfter = newBalances[takerAddress][defaultMakerAssetAddress];
            const afterEthBalance = await web3Wrapper.getBalanceInWeiAsync(feeRecipientAddress);
            const takerBoughtAmount = takerBalanceAfter.minus(erc20Balances[takerAddress][defaultMakerAssetAddress]);

            expect(makerBalanceAfter).to.be.bignumber.equal(makerBalanceBefore.minus(takerBoughtAmount));
            expect(afterEthBalance).to.be.bignumber.equal(
                initEthBalance.plus(fillAmount.times(feeProportion).dividedBy(10000)),
            );
            expect(newBalances[forwarderContract.address][weth.address]).to.be.bignumber.equal(new BigNumber(0));
        });
        it('should fail if the fee is set too high', async () => {
            const initEthBalance = await web3Wrapper.getBalanceInWeiAsync(feeRecipientAddress);
            const fillAmount = signedOrder.takerAssetAmount.div(2);
            feeProportion = 1500; // 15.0%
            feeOrders = [];
            expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.marketBuyTokensFeeAsync(signedOrders, feeOrders, feeProportion, feeRecipientAddress, {
                    from: takerAddress,
                    value: fillAmount,
                }),
            );
            const afterEthBalance = await web3Wrapper.getBalanceInWeiAsync(feeRecipientAddress);
            expect(afterEthBalance).to.be.bignumber.equal(initEthBalance);
        });
    });
    describe('buyExactAssets', () => {
        it('should buy the exact amount of assets', async () => {
            const makerAssetAmount = signedOrder.makerAssetAmount.div(2);
            const initEthBalance = await web3Wrapper.getBalanceInWeiAsync(takerAddress);
            const balancesBefore = await erc20Wrapper.getBalancesAsync();
            const rate = signedOrder.makerAssetAmount.dividedBy(signedOrder.takerAssetAmount);
            const fillAmountWei = makerAssetAmount.dividedToIntegerBy(rate);
            feeOrders = [];
            tx = await forwarderWrapper.buyExactAssetsAsync(signedOrders, feeOrders, makerAssetAmount, {
                from: takerAddress,
                value: fillAmountWei,
                gasPrice: new BigNumber(1),
            });
            const newBalances = await erc20Wrapper.getBalancesAsync();
            const takerBalanceBefore = balancesBefore[takerAddress][defaultMakerAssetAddress];
            const takerBalanceAfter = newBalances[takerAddress][defaultMakerAssetAddress];
            const afterEthBalance = await web3Wrapper.getBalanceInWeiAsync(takerAddress);
            const expectedEthBalanceAfterGasCosts = initEthBalance.minus(fillAmountWei).minus(tx.gasUsed);
            expect(takerBalanceAfter).to.be.bignumber.eq(takerBalanceBefore.plus(makerAssetAmount));
            expect(afterEthBalance).to.be.bignumber.eq(expectedEthBalanceAfterGasCosts);
        });
        it('should buy the exact amount of assets and return excess ETH', async () => {
            const makerAssetAmount = signedOrder.makerAssetAmount.div(2);
            const initEthBalance = await web3Wrapper.getBalanceInWeiAsync(takerAddress);
            const balancesBefore = await erc20Wrapper.getBalancesAsync();
            const rate = signedOrder.makerAssetAmount.dividedBy(signedOrder.takerAssetAmount);
            const fillAmount = makerAssetAmount.dividedToIntegerBy(rate);
            const excessFillAmount = fillAmount.times(2);
            feeOrders = [];
            tx = await forwarderWrapper.buyExactAssetsAsync(signedOrders, feeOrders, makerAssetAmount, {
                from: takerAddress,
                value: excessFillAmount,
                gasPrice: new BigNumber(1),
            });
            const newBalances = await erc20Wrapper.getBalancesAsync();
            const takerBalanceBefore = balancesBefore[takerAddress][defaultMakerAssetAddress];
            const takerBalanceAfter = newBalances[takerAddress][defaultMakerAssetAddress];
            const afterEthBalance = await web3Wrapper.getBalanceInWeiAsync(takerAddress);
            const expectedEthBalanceAfterGasCosts = initEthBalance.minus(fillAmount).minus(tx.gasUsed);
            expect(takerBalanceAfter).to.be.bignumber.eq(takerBalanceBefore.plus(makerAssetAmount));
            expect(afterEthBalance).to.be.bignumber.eq(expectedEthBalanceAfterGasCosts);
        });
        it('should buy the exact amount of assets with fee abstraction', async () => {
            const makerAssetAmount = signedOrder.makerAssetAmount.div(2);
            const balancesBefore = await erc20Wrapper.getBalancesAsync();
            const rate = signedOrder.makerAssetAmount.dividedBy(signedOrder.takerAssetAmount);
            const fillAmount = makerAssetAmount.dividedToIntegerBy(rate);
            const excessFillAmount = fillAmount.times(2);
            tx = await forwarderWrapper.buyExactAssetsAsync(signedOrdersWithFee, feeOrders, makerAssetAmount, {
                from: takerAddress,
                value: excessFillAmount,
            });
            const newBalances = await erc20Wrapper.getBalancesAsync();
            const takerBalanceBefore = balancesBefore[takerAddress][defaultMakerAssetAddress];
            const takerBalanceAfter = newBalances[takerAddress][defaultMakerAssetAddress];
            expect(takerBalanceAfter).to.be.bignumber.eq(takerBalanceBefore.plus(makerAssetAmount));
        });
        it('should buy the exact amount of assets when buying zrx with fee abstraction', async () => {
            signedOrder = orderFactory.newSignedOrder({
                makerAssetData: assetProxyUtils.encodeERC20AssetData(zrxToken.address),
                takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(1), DECIMALS_DEFAULT),
            });
            signedOrdersWithFee = [signedOrder];
            feeOrders = [];
            const makerAssetAmount = signedOrder.makerAssetAmount.div(2);
            const takerWeiBalanceBefore = await web3Wrapper.getBalanceInWeiAsync(takerAddress);
            const balancesBefore = await erc20Wrapper.getBalancesAsync();
            const fillAmountWei = await forwarderWrapper.calculateBuyExactFillAmountWeiAsync(
                signedOrdersWithFee,
                feeOrders,
                feeProportion,
                makerAssetAmount,
            );
            tx = await forwarderWrapper.buyExactAssetsAsync(signedOrdersWithFee, feeOrders, makerAssetAmount, {
                from: takerAddress,
                value: fillAmountWei,
                gasPrice: new BigNumber(1),
            });
            const newBalances = await erc20Wrapper.getBalancesAsync();
            const takerTokenBalanceBefore = balancesBefore[takerAddress][zrxToken.address];
            const takerTokenBalanceAfter = newBalances[takerAddress][zrxToken.address];
            const takerWeiBalanceAfter = await web3Wrapper.getBalanceInWeiAsync(takerAddress);
            const expectedCostAfterGas = fillAmountWei.plus(tx.gasUsed);
            expect(takerTokenBalanceAfter).to.be.bignumber.greaterThan(takerTokenBalanceBefore.plus(makerAssetAmount));
            expect(takerWeiBalanceAfter).to.be.bignumber.equal(takerWeiBalanceBefore.minus(expectedCostAfterGas));
        });
        it('throws if fees are higher than 5% when buying zrx', async () => {
            const highFeeZRXOrder = orderFactory.newSignedOrder({
                makerAssetData: assetProxyUtils.encodeERC20AssetData(zrxToken.address),
                makerAssetAmount: signedOrder.makerAssetAmount,
                takerFee: signedOrder.makerAssetAmount.times(0.06),
            });
            signedOrdersWithFee = [highFeeZRXOrder];
            feeOrders = [];
            const makerAssetAmount = signedOrder.makerAssetAmount.div(2);
            const fillAmountWei = await forwarderWrapper.calculateBuyExactFillAmountWeiAsync(
                signedOrdersWithFee,
                feeOrders,
                feeProportion,
                makerAssetAmount,
            );
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.buyExactAssetsAsync(signedOrdersWithFee, feeOrders, makerAssetAmount, {
                    from: takerAddress,
                    value: fillAmountWei,
                }),
            );
        });
        it('throws if fees are higher than 5% when buying erc20', async () => {
            const highFeeERC20Order = orderFactory.newSignedOrder({
                takerFee: signedOrder.makerAssetAmount.times(0.06),
            });
            signedOrdersWithFee = [highFeeERC20Order];
            feeOrders = [feeOrder];
            const makerAssetAmount = signedOrder.makerAssetAmount.div(2);
            const fillAmountWei = await forwarderWrapper.calculateBuyExactFillAmountWeiAsync(
                signedOrdersWithFee,
                feeOrders,
                feeProportion,
                makerAssetAmount,
            );
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.buyExactAssetsAsync(signedOrdersWithFee, feeOrders, makerAssetAmount, {
                    from: takerAddress,
                    value: fillAmountWei,
                }),
            );
        });
        it('throws if makerAssetAmount is 0', async () => {
            const makerAssetAmount = new BigNumber(0);
            const fillAmountWei = await forwarderWrapper.calculateBuyExactFillAmountWeiAsync(
                signedOrdersWithFee,
                feeOrders,
                feeProportion,
                makerAssetAmount,
            );
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.buyExactAssetsAsync(signedOrdersWithFee, feeOrders, makerAssetAmount, {
                    from: takerAddress,
                    value: fillAmountWei,
                }),
            );
        });
        it('throws if the amount of ETH sent in is less than the takerAssetFilledAmount', async () => {
            const makerAssetAmount = signedOrder.makerAssetAmount;
            const fillAmount = signedOrder.takerAssetAmount.div(2);
            const zero = new BigNumber(0);
            // Deposit enough taker balance to fill the order
            const wethDepositTxHash = await wethContract.deposit.sendTransactionAsync({
                from: takerAddress,
                value: signedOrder.takerAssetAmount,
            });
            await web3Wrapper.awaitTransactionSuccessAsync(wethDepositTxHash);
            // Transfer all of this WETH to the forwarding contract
            const wethTransferTxHash = await wethContract.transfer.sendTransactionAsync(
                forwarderContract.address,
                signedOrder.takerAssetAmount,
                { from: takerAddress },
            );
            await web3Wrapper.awaitTransactionSuccessAsync(wethTransferTxHash);
            // We use the contract directly to get around wrapper validations and calculations
            const formattedOrders = formatters.createMarketSellOrders(signedOrders, zero);
            const formattedFeeOrders = formatters.createMarketSellOrders(feeOrders, zero);
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderContract.buyExactAssets.sendTransactionAsync(
                    formattedOrders.orders,
                    formattedOrders.signatures,
                    formattedFeeOrders.orders,
                    formattedFeeOrders.signatures,
                    makerAssetAmount,
                    zero,
                    constants.NULL_ADDRESS,
                    { value: fillAmount, from: takerAddress },
                ),
            );
        });
    });
    describe('buyExactAssets - ERC721', async () => {
        it('buys ERC721 assets', async () => {
            const makerAssetId = erc721MakerAssetIds[0];
            signedOrder = orderFactory.newSignedOrder({
                makerAssetAmount: new BigNumber(1),
                makerAssetData: assetProxyUtils.encodeERC721AssetData(erc721Token.address, makerAssetId),
            });
            feeOrders = [];
            signedOrders = [signedOrder];
            const makerAssetAmount = new BigNumber(signedOrders.length);
            const fillAmountWei = await forwarderWrapper.calculateBuyExactFillAmountWeiAsync(
                signedOrders,
                feeOrders,
                feeProportion,
                makerAssetAmount,
            );
            tx = await forwarderWrapper.buyExactAssetsAsync(signedOrders, feeOrders, makerAssetAmount, {
                from: takerAddress,
                value: fillAmountWei,
            });
            const newOwnerTakerAsset = await erc721Token.ownerOf.callAsync(makerAssetId);
            expect(newOwnerTakerAsset).to.be.bignumber.equal(takerAddress);
        });
        it('buys ERC721 assets with fee abstraction', async () => {
            const makerAssetId = erc721MakerAssetIds[0];
            signedOrder = orderFactory.newSignedOrder({
                makerAssetAmount: new BigNumber(1),
                takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(1), DECIMALS_DEFAULT),
                makerAssetData: assetProxyUtils.encodeERC721AssetData(erc721Token.address, makerAssetId),
            });
            signedOrders = [signedOrder];
            const makerAssetAmount = new BigNumber(signedOrders.length);
            const fillAmountWei = await forwarderWrapper.calculateBuyExactFillAmountWeiAsync(
                signedOrders,
                feeOrders,
                feeProportion,
                makerAssetAmount,
            );
            tx = await forwarderWrapper.buyExactAssetsAsync(signedOrders, feeOrders, makerAssetAmount, {
                from: takerAddress,
                value: fillAmountWei,
            });
            const newOwnerTakerAsset = await erc721Token.ownerOf.callAsync(makerAssetId);
            expect(newOwnerTakerAsset).to.be.bignumber.equal(takerAddress);
        });
        it('buys ERC721 assets with fee abstraction and pays fee to fee recipient', async () => {
            const makerAssetId = erc721MakerAssetIds[0];
            signedOrder = orderFactory.newSignedOrder({
                makerAssetAmount: new BigNumber(1),
                takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(1), DECIMALS_DEFAULT),
                makerAssetData: assetProxyUtils.encodeERC721AssetData(erc721Token.address, makerAssetId),
            });
            signedOrders = [signedOrder];
            feeProportion = 10;
            const makerAssetAmount = new BigNumber(signedOrders.length);
            const fillAmountWei = await forwarderWrapper.calculateBuyExactFillAmountWeiAsync(
                signedOrders,
                feeOrders,
                feeProportion,
                makerAssetAmount,
            );
            tx = await forwarderWrapper.buyExactAssetsAsync(signedOrders, feeOrders, makerAssetAmount, {
                from: takerAddress,
                value: fillAmountWei,
            });
            const newOwnerTakerAsset = await erc721Token.ownerOf.callAsync(makerAssetId);
            expect(newOwnerTakerAsset).to.be.bignumber.equal(takerAddress);
        });
        it('buys multiple ERC721 assets with fee abstraction and pays fee to fee recipient', async () => {
            const makerAssetId1 = erc721MakerAssetIds[0];
            const makerAssetId2 = erc721MakerAssetIds[1];
            const signedOrder1 = orderFactory.newSignedOrder({
                makerAssetAmount: new BigNumber(1),
                takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(3), DECIMALS_DEFAULT),
                makerAssetData: assetProxyUtils.encodeERC721AssetData(erc721Token.address, makerAssetId1),
            });
            const signedOrder2 = orderFactory.newSignedOrder({
                makerAssetAmount: new BigNumber(1),
                takerFee: Web3Wrapper.toBaseUnitAmount(new BigNumber(4), DECIMALS_DEFAULT),
                makerAssetData: assetProxyUtils.encodeERC721AssetData(erc721Token.address, makerAssetId2),
            });
            signedOrders = [signedOrder1, signedOrder2];
            feeProportion = 10;
            const makerAssetAmount = new BigNumber(signedOrders.length);
            const fillAmountWei = await forwarderWrapper.calculateBuyExactFillAmountWeiAsync(
                signedOrders,
                feeOrders,
                feeProportion,
                makerAssetAmount,
            );
            tx = await forwarderWrapper.buyExactAssetsAsync(signedOrders, feeOrders, makerAssetAmount, {
                from: takerAddress,
                value: fillAmountWei,
            });
            const newOwnerTakerAsset1 = await erc721Token.ownerOf.callAsync(makerAssetId1);
            expect(newOwnerTakerAsset1).to.be.bignumber.equal(takerAddress);
            const newOwnerTakerAsset2 = await erc721Token.ownerOf.callAsync(makerAssetId2);
            expect(newOwnerTakerAsset2).to.be.bignumber.equal(takerAddress);
        });
        it('throws when mixed ERC721 and ERC20 assets', async () => {
            const makerAssetId = erc721MakerAssetIds[0];
            const erc721SignedOrder = orderFactory.newSignedOrder({
                makerAssetAmount: new BigNumber(1),
                makerAssetData: assetProxyUtils.encodeERC721AssetData(erc721Token.address, makerAssetId),
            });
            const erc20SignedOrder = orderFactory.newSignedOrder();
            signedOrders = [erc721SignedOrder, erc20SignedOrder];
            const makerAssetAmount = new BigNumber(signedOrders.length);
            const fillAmountWei = erc20SignedOrder.takerAssetAmount.plus(erc721SignedOrder.takerAssetAmount);
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.buyExactAssetsAsync(signedOrders, feeOrders, makerAssetAmount, {
                    from: takerAddress,
                    value: fillAmountWei,
                }),
            );
        });
        it('throws when mixed ERC721 and ERC20 assets with ERC20 first', async () => {
            const makerAssetId = erc721MakerAssetIds[0];
            const erc721SignedOrder = orderFactory.newSignedOrder({
                makerAssetAmount: new BigNumber(1),
                makerAssetData: assetProxyUtils.encodeERC721AssetData(erc721Token.address, makerAssetId),
            });
            const erc20SignedOrder = orderFactory.newSignedOrder();
            signedOrders = [erc20SignedOrder, erc721SignedOrder];
            const makerAssetAmount = new BigNumber(signedOrders.length);
            const fillAmountWei = erc20SignedOrder.takerAssetAmount.plus(erc721SignedOrder.takerAssetAmount);
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.buyExactAssetsAsync(signedOrders, feeOrders, makerAssetAmount, {
                    from: takerAddress,
                    value: fillAmountWei,
                }),
            );
        });
        it('throws when makerAssetAmount does not equal ERC721 order size', async () => {
            const makerAssetId = erc721MakerAssetIds[0];
            signedOrder = orderFactory.newSignedOrder({
                makerAssetAmount: new BigNumber(1),
                makerAssetData: assetProxyUtils.encodeERC721AssetData(erc721Token.address, makerAssetId),
            });
            signedOrders = [signedOrder];
            const makerAssetAmount = new BigNumber(10);
            const fillAmountWei = signedOrder.takerAssetAmount;
            return expectRevertOrAlwaysFailingTransactionAsync(
                forwarderWrapper.buyExactAssetsAsync(signedOrders, feeOrders, makerAssetAmount, {
                    from: takerAddress,
                    value: fillAmountWei,
                }),
            );
        });
    });
});
// tslint:disable:max-file-line-count
// tslint:enable:no-unnecessary-type-assertion
