import {test,expect} from '@playwright/test';

test.beforeEach(async({page,request})=>{
    await request.post('http://127.0.0.1:8093/__test/reset');
    // Only Cognito identity is substituted. The app, Rive, API and document
    // transactions execute their real code against the offline test server.
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

test('profile owns settings and the pet tab opens group care',async({page})=>{
    await page.locator('#btn-user-menu-toggle').click();
    await page.locator('#btn-menu-more').click();
    await expect(page.locator('#view-more')).toHaveClass(/active/);
    await page.locator('#btn-bottom-pets').click();
    await expect(page.locator('#btn-bottom-pets')).toHaveAttribute('aria-current','page');
    await page.getByRole('button',{name:'進入',exact:false}).first().click();
    await expect(page.locator('#pet-stage')).toHaveClass(/illustrated-ready/,{timeout:20000});
    await expect(page.locator('#pet-tama-name')).toHaveText('奶糖');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('draw retry survives reload; backpack food consumes once and toys stay owned',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const enter=async()=>{
        await expect(page.locator('#auth-logged-in')).toBeVisible();
        await expect(page.locator('#view-home')).toHaveClass(/active/);
        await page.locator('#btn-bottom-pets').click();
        await page.getByRole('button',{name:'進入',exact:false}).first().click();
        await expect(page.locator('#pet-stage')).toHaveClass(/illustrated-ready/,{timeout:20000});
    };
    await enter();await page.locator('#btn-pet-draw').click();
    let lost=true;const requests=[];
    await page.route('**/api/groups/browser-group/pet/draw',async route=>{
        requests.push(route.request().postDataJSON());
        const response=await route.fetch({url:route.request().url().replace(':8080',':8093')});
        if(lost){lost=false;await route.abort();}else await route.fulfill({response});
    });
    await page.locator('.care-draw-card').first().click();
    await expect(page.locator('#pet-draw-status')).toContainText('尚未確認');
    await page.reload();await enter();await page.locator('#btn-pet-draw').click();
    await expect(page.locator('.care-draw-card').first()).toContainText('重試確認結果');
    await page.locator('.care-draw-card').first().click();
    await expect(page.locator('#pet-draw-status')).toContainText('沒有再次扣款');
    expect(requests[0].request_id).toBe(requests[1].request_id);
    await expect(page.locator('[data-shop-coins]')).toHaveText('174');
    const itemName=await page.locator('[data-shop-result] strong').textContent();
    await page.locator('[data-shop-tab=bag]').click();
    const food=page.locator('.care-bag-item').filter({has:page.locator('strong',{hasText:itemName})});
    await expect(food).toContainText('3 份');
    await food.getByRole('button').click();
    await expect(page.locator('#pet-stage')).toHaveAttribute('data-care-phase','feedComplete');
    await expect(page.locator('#pet-care-result')).toContainText(itemName);
    await page.locator('#btn-pet-bag').click();await expect(food).toContainText('2 份');
    await page.locator('[data-shop-kind=toy]').click();
    const plush=page.locator('.care-bag-item').filter({has:page.locator('strong',{hasText:'星星布偶'})});
    await plush.getByRole('button').click();
    await expect(page.locator('#pet-stage')).toHaveAttribute('data-care-phase','playComplete');
    await page.locator('#btn-pet-bag').click();await page.locator('[data-shop-kind=toy]').click();
    await expect(plush).toContainText('已收藏');
    await page.screenshot({path:'test-results/pet-backpack.png'});
    expect(errors).toEqual([]);
});

test('every toy has a native completion and keeps the front paws still',async({page})=>{
    await page.evaluate(()=>{
        const holder=document.createElement('div');holder.id='native-toy-review';
        Object.assign(holder.style,{position:'fixed',inset:'0',width:'640px',height:'640px',zIndex:'9999',background:'#fffdf7'});
        document.body.append(holder);
    });
    const result=await page.evaluate(async()=>{
        const {IllustratedPetViewer}=await import('/features/pets/illustrated-viewer.js');
        const data=await (await fetch('http://127.0.0.1:8080/api/groups/browser-group/pet',{headers:{Authorization:'Bearer test'}})).json();
        const viewer=new IllustratedPetViewer(document.querySelector('#native-toy-review'));
        await viewer.load();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const pixels=()=>viewer.canvas.getContext('2d')?.getImageData(250,460,130,38).data;
        const baseline=Array.from(pixels());const results=[];
        for(const item of data.care_catalog.items.filter(i=>i.kind==='toy')) {
            const playing=viewer.playAndWait('play',item);
            await new Promise(r=>setTimeout(r,650));
            const current=pixels();let delta=0;
            for(let i=0;i<baseline.length;i++)delta=Math.max(delta,Math.abs(baseline[i]-current[i]));
            results.push({id:item.id,complete:await playing,pawPixelDelta:delta});
        }
        viewer.dispose();document.querySelector('#native-toy-review').remove();return results;
    });
    expect(result).toHaveLength(7);
    for(const toy of result){expect(toy.complete,toy.id).toBe(true);expect(toy.pawPixelDelta,toy.id).toBeLessThanOrEqual(4);}
});


test('small pet uses the designated member while full care keeps its character',async({page})=>{
    await page.locator('#home-groups-grid .group-card').first().click();
    await expect(page.locator('#group-members-row')).toContainText('本機測試');
    await page.locator('#btn-mini-pet-person').click();
    await page.locator('#mini-person-select').selectOption('browser-owner');
    await page.locator('#mini-person-save').click();
    await expect(page.locator('#mini-person-dialog')).not.toBeVisible();
    await expect(page.locator('#group-mini-companion .mini-person-head')).toBeVisible();
    await page.locator('[data-mini-touch]').click();
    await expect(page.locator('.mini-pet-words')).toContainText('有你陪著');
    await page.locator('[data-mini-enter]').click();
    await expect(page.locator('#pet-stage')).toHaveClass(/illustrated-ready/,{timeout:20000});
    await expect(page.locator('#pet-tama-name')).toHaveText('奶糖');
    expect(await page.locator('#pet-stage .mini-person-head').count()).toBe(0);
});

test('main care buttons let users choose before any food or toy is used',async({page})=>{
    const actions=[];page.on('request',r=>{if(r.url().endsWith('/pet/action')&&r.method()==='POST')actions.push(r.postDataJSON());});
    await page.locator('#btn-bottom-pets').click();await page.locator('.btn-care-pet').first().click();
    await expect(page.locator('#pet-stage')).toHaveClass(/illustrated-ready/,{timeout:20000});
    await page.locator('#btn-pet-feed').click();
    await expect(page.locator('#pet-shop-title')).toHaveText('選擇食物');
    await expect(page.locator('.care-shop-wallet')).not.toBeVisible();
    await expect(page.locator('.care-bag-item').filter({has:page.locator('strong',{hasText:'手作愛心餅'})}).getByRole('button')).toBeDisabled();
    expect(actions).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#btn-pet-feed')).toBeFocused();
    expect(actions).toHaveLength(0);
    await page.locator('#btn-pet-feed').click();
    await page.locator('.care-bag-item').filter({has:page.locator('strong',{hasText:'燕麥小餅'})}).getByRole('button').click();
    await expect(page.locator('#pet-stage')).toHaveAttribute('data-care-phase','feedComplete');
    expect(actions[0].item_id).toBe('oat_biscuit');
    await page.locator('#btn-pet-play').click();
    await expect(page.locator('#pet-shop-title')).toHaveText('選擇玩具');
    expect(actions).toHaveLength(1);
    await page.locator('.care-bag-item').filter({has:page.locator('strong',{hasText:'星星布偶'})}).getByRole('button').click();
    await expect(page.locator('#pet-stage')).toHaveAttribute('data-care-phase','playComplete');
    expect(actions[1].item_id).toBe('star_plush');
});

test('main care retry keeps the selected item without reopening the picker',async({page})=>{
    const actions=[];let lost=true;
    await page.route('**/api/groups/browser-group/pet/action',async r=>{
        actions.push(r.request().postDataJSON());
        const response=await r.fetch({url:r.request().url().replace(':8080',':8093')});
        if(lost){lost=false;await r.abort();}else await r.fulfill({response});
    });
    await page.locator('#btn-bottom-pets').click();await page.locator('.btn-care-pet').first().click();
    await page.locator('#btn-pet-play').click();
    await page.locator('.care-bag-item').filter({has:page.locator('strong',{hasText:'星星布偶'})}).getByRole('button').click();
    await expect(page.locator('#pet-play-state')).toHaveText('重試確認結果');
    await page.locator('#btn-pet-play').click();
    await expect(page.locator('#pet-sync-status')).toHaveText('已同步群組狀態');
    expect(actions).toHaveLength(2);
    expect(actions[1]).toEqual(actions[0]);
    expect(actions[0].item_id).toBe('star_plush');
    await expect(page.locator('#pet-care-shop')).not.toBeVisible();
});
