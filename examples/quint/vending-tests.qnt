module VendingTests {
    import Spec.* from "./Spec"

    // return_all はアクション名であり、生成モデルの残高に代入する式を持たない。
    run refundTest = init
        .then(tr_Idle_coin_inserted_Selecting)
        .then(tr_Selecting_refund_Idle)
        .expect(phase == "Idle" and state_balance > 0)

    run dispenseTest = init
        .then(tr_Idle_coin_inserted_Selecting)
        .then(tr_Selecting_choose_item_Dispensing)
        .then(tr_Dispensing_tau_Done)
        .then(step)
        .expect(phase == "Done")
}
