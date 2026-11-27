import {test,expect} from '@playwright/test';

// 測試伺服器的假資料：自己有 1 張個人券，群組背包有 4 件同款徽章（保留 1 件後可換 1 張群組券）。
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

test('duplicates become shared group tickets, drawing lets you pick the ticket, and the group chat is told',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.locator('#btn-bottom-pets').click();await page.locator('.btn-care-pet').first().click();
    await expect(page.locator('#pet-stage')).toHaveClass(/illustrated-ready/,{timeout:20000});

    // 背包：4 件同款只能換 1 張（保留 1 件），換到的是群組券
    await page.locator('#btn-pet-bag').click();
    await page.locator('[data-shop-kind=costume]').click();
    const costume=page.locator('.care-bag-item').filter({hasText:'×4'});
    await expect(costume).toContainText('可兌換 1 張群組抽獎券');
    await costume.getByRole('button',{name:'兌換群組抽獎券'}).click();
    await expect(page.locator('#pet-shop-tickets')).toHaveText('個人 1 · 群組 1');
    await expect(page.locator('.care-bag-item').filter({hasText:'可兌換'})).toHaveCount(0);
    await page.locator('[data-shop-close]').click();

    // 扭蛋機：兩種券都有，單抽會先問要用哪一種
    await page.locator('#btn-pet-gacha').click();
    await expect(page.locator('#gacha-user-tickets')).toHaveText('1');
    await expect(page.locator('#gacha-group-tickets')).toHaveText('1');
    await page.getByRole('button',{name:'抽扭蛋',exact:true}).click();
    await page.locator('#btn-gacha-draw-1').click();
    const sheet=page.locator('#gacha-ticket-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('群組共用，剩 1 張');
    await expect(sheet.getByRole('button',{name:'取消'})).toBeInViewport();
    await page.screenshot({path:'test-results/group-ticket-choice.png'});
    await sheet.getByRole('button',{name:'取消'}).click();
    await expect(sheet).not.toBeVisible();
    await expect(page.locator('#gacha-group-tickets')).toHaveText('1');
    await page.locator('#btn-gacha-draw-1').click();
    await sheet.locator('[data-ticket-source=group]').click();
    await expect(page.locator('#gacha-group-tickets')).toHaveText('0');
    await expect(page.locator('#gacha-user-tickets')).toHaveText('1');
    await expect(page.locator('#gacha-user-points')).toHaveText('204');

    // 只剩個人券時直接用，不再跳選單
    await expect(page.locator('#btn-gacha-draw-1')).toBeEnabled({timeout:15000});
    await page.locator('#btn-gacha-draw-1').click();
    await expect(sheet).not.toBeVisible();
    await expect(page.locator('#gacha-user-tickets')).toHaveText('0');

    // 群組聊天室：兌換與用群組券抽各一則系統通知；用個人券不通知
    await page.goto('/');
    await expect(page.locator('#auth-logged-in')).toBeVisible();
    await page.locator('#home-groups-grid .group-card').first().click();
    await page.locator('#btn-group-chat').click();
    const notes=page.locator('.chat-system-note');
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(0)).toContainText('本機測試 用 3 件「');
    await expect(notes.nth(0)).toContainText('換了 1 張群組抽獎券');
    await expect(notes.nth(1)).toContainText('本機測試 用 1 張群組抽獎券抽到了「');
    await page.screenshot({path:'test-results/group-chat-system-notes.png'});
    expect(errors).toEqual([]);
});
