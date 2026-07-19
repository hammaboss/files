document.body.style.display = 'none';

const myNewPage = `
    <div style="text-align: center; margin-top: 50px; font-family: Arial;">
        <h1>مرحباً بك في صفحتي الخاصة</h1>
        <p>هذه الصفحة تظهر بالكامل من ملف الجافا سكريبت على GitHub.</p>
    </div>
`;

document.body.insertAdjacentHTML('afterbegin', myNewPage);
document.body.style.display = 'block';
