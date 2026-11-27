import {test,expect} from '@playwright/test';

// 測試伺服器的假資料：群組背包有 4 件同款徽章（每 3 件換 1 張群組抽獎卷），沒有抽獎卷，自己有 204 金幣。
test.beforeEach(async({page,request})=>{
    await request.post('http://127.0.0.1:8093/__test/reset');
    await page.addInitScript(()=>{
        const token = `${btoa('{}')}.${btoa(JSON.stringify({sub:'browser-owner',email:'browser@example.test',name:'Local Review'}))}.test`;
        localStorage.setItem('phubbing_cognito_session',JSON.stringify({idToken:token,expiresAt:Date.now()+3600000,refreshToken:'test'}));
    });
    await page.route('http://127.0.0.1:8080/**',async route=>{
        const response=await route.fetch({url:route.request().url().replace(':8080',':8093')});
        await route.fulfill({response});
    });
    await page.goto('/');
    await expect(page.locator('#auth-logged-in')).toBeVisible();
});

test('duplicates become group tickets, a ticket draw is free and tells the group chat',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.locator('#btn-bottom-pets').click();await page.locator('.btn-care-pet').first().click();
    await expect(page.locator('#pet-stage')).toHaveClass(/illustrated-ready/,{timeout:20000});

    // 背包：4 件同款可換 1 張（用掉 3 件），換到的是群組抽獎卷
    await page.locator('#btn-pet-bag').click();
    await page.locator('[data-shop-kind=costume]').click();
    const costume=page.locator('.care-bag-item').filter({hasText:'×4'});
    await expect(costume).toContainText('可兌換 1 張抽獎卷');
    await costume.getByRole('button',{name:'兌換群組抽獎券'}).click();
    await expect(page.locator('#pet-shop-tickets')).toHaveText('1');
    await expect(page.locator('.care-bag-item').filter({hasText:'可兌換'})).toHaveCount(0);
    await page.locator('[data-shop-close]').click();

    // 扭蛋機：有抽獎卷時單抽直接用卷、不扣金幣
    await page.locator('#btn-pet-gacha').click();
    await expect(page.locator('#gacha-group-tickets')).toHaveText('1');
    await page.getByRole('button',{name:'抽扭蛋',exact:true}).click();
    await page.locator('#btn-gacha-draw-1').click();
    await expect(page.locator('#gacha-group-tickets')).toHaveText('0');
    await expect(page.locator('#gacha-user-points')).toHaveText('204');

    // 抽獎卷用完後單抽改扣 30 金幣，也不會發通知
    await expect(page.locator('#btn-gacha-draw-1')).toBeEnabled({timeout:15000});
    await page.locator('#btn-gacha-draw-1').click();
    await expect(page.locator('#gacha-user-points')).toHaveText('174');

    // 群組聊天室：只有用群組抽獎卷的那一次有系統通知
    await page.goto('/');
    await expect(page.locator('#auth-logged-in')).toBeVisible();
    await page.locator('#home-groups-grid .group-card').first().click();
    await page.locator('#btn-group-chat').click();
    const notes=page.locator('.chat-system-note');
    await expect(notes).toHaveCount(1);
    await expect(notes.first()).toContainText('本機測試 用了 1 張群組抽獎卷抽扭蛋');
    await expect(notes.first()).toContainText('剩餘 0 張');
    expect(errors).toEqual([]);
});
